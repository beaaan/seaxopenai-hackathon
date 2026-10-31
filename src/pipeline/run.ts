import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { Gateway } from "../core/llm/gateway";
import { loadFolk, loadPolicyPackage, loadReference, makeVersion, versionZero } from "../core/policy";
import { eventsPath, RunWriter } from "../core/store";
import { POLICIES_DIR } from "../core/paths";
import type { EventPayload, EventType, RunEvent } from "../shared/events";
import { Dimension, RunConfig, type AllocationDecision, type BaselineRun, type Cluster, type Coding, type FidelityResult, type Finding, type Grade, type HumanAnswer, type HumanMapping, type HumanQuestion, type Iteration, type PolicyVersion, type Reading, type Scenario } from "../shared/schema";
import { extractDimensions } from "../sampler/dims";
import { coveringArray } from "../sampler/covering";
import { writeScenarios } from "../sampler/scenarios";
import { readScenario } from "../sampler/reader";
import { createReviewer, rowsForDecision, type Reviewer } from "../sampler/allocate";
import { discoveryCurve, homogeneity, splitTable } from "../sampler/stats";
import { DEFAULT_CONFLICT_THRESHOLD, gradeReadings } from "../reviewer/grade";
import { clusterInterpretations } from "../reviewer/cluster";
import { codeReadings } from "../reviewer/code";
import { draftFindings } from "../reviewer/findings";
import { classifyByRepair } from "../reviewer/classify";
import { rewritePolicy, type RewriteCandidate } from "../reviewer/rewrite";
import { checkFidelity } from "../reviewer/fidelity";
import { conflictRate, iterationMetrics, noiseBand, reproductionNoise } from "../reviewer/metrics";
import { stopDecision } from "../reviewer/stop";
import { runBaseline } from "../eval/baseline";
import { scoreAgainstHoldout } from "../eval/score";
import { humanQuestions } from "../eval/human";
import { runProbe } from "../sandbox/episode";
import { DEFAULT_ASSUMPTIONS } from "../sandbox/rule";
import type { StageContext } from "./context";

/** A replayable, pure fold of domain events; no gateway or filesystem state. */
export interface RunState {
  config: RunConfig | null;
  policies: PolicyVersion[];
  dimensions: Dimension[];
  scenarios: Scenario[];
  readings: Reading[];
  grades: Grade[];
  codings: Coding[];
  clusters: Cluster[];
  codebook: Cluster[];
  findings: Finding[];
  iterations: Iteration[];
  baselines: BaselineRun[];
  questions: HumanQuestion[];
  answers: HumanAnswer[];
  mappings: HumanMapping[];
  finalVersion: number | null;
}

export function reduceRunEvent(state: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case "run.started": return { ...state, config: event.payload.config };
    case "policy.version": return { ...state, policies: [...state.policies.filter((p) => p.version !== event.payload.policy.version), event.payload.policy] };
    case "dims.extracted": return { ...state, dimensions: event.payload.dimensions };
    case "scenario.created": return { ...state, scenarios: [...state.scenarios, event.payload.scenario] };
    case "reading.completed": return { ...state, readings: [...state.readings.filter((r) => r.id !== event.payload.reading.id), event.payload.reading] };
    case "grades.added": {
      const ids = new Set(event.payload.grades.map((g) => g.interpretationId));
      return { ...state, grades: [...state.grades.filter((g) => !ids.has(g.interpretationId)), ...event.payload.grades] };
    }
    case "codings.added": {
      const ids = new Set(event.payload.codings.map((c) => c.readingId));
      return { ...state, codings: [...state.codings.filter((c) => !ids.has(c.readingId)), ...event.payload.codings] };
    }
    case "clusters.updated": return { ...state, clusters: [...state.clusters.filter((c) => c.policyVersion !== event.payload.policyVersion), ...event.payload.clusters] };
    case "codebook.fixed": {
      const ids = new Set(event.payload.clusterIds);
      return { ...state, codebook: state.clusters.filter((c) => ids.has(c.id)) };
    }
    case "findings.updated": return { ...state, findings: event.payload.findings };
    case "iteration.completed": return { ...state, iterations: [...state.iterations, event.payload.iteration] };
    case "baseline.completed": return { ...state, baselines: [...state.baselines, event.payload.run] };
    case "human.question": return { ...state, questions: [...state.questions, event.payload.question] };
    case "human.answer": return { ...state, answers: [...state.answers, event.payload.answer] };
    case "human.mapped": return { ...state, mappings: [...state.mappings, event.payload.mapping] };
    case "stop.decided": return { ...state, finalVersion: event.payload.finalVersion };
    default: return state;
  }
}

export function rebuildRunState(events: RunEvent[]): RunState {
  return events.reduce(reduceRunEvent, {
    config: null, policies: [], dimensions: [], scenarios: [], readings: [], grades: [], codings: [],
    clusters: [], codebook: [], findings: [], iterations: [], baselines: [], questions: [], answers: [], mappings: [], finalVersion: null,
  });
}

/** Central event-writing boundary shared by run, retest, and human mapping. */
export class RunRecorder {
  readonly writer: RunWriter;
  state: RunState;

  constructor(runId: string, events: RunEvent[] = [], fresh = false) {
    if (fresh && existsSync(eventsPath(runId))) throw new Error(`run already exists: ${runId}`);
    this.writer = new RunWriter(runId);
    this.state = rebuildRunState(events);
  }

  emit<T extends EventType>(type: T, payload: EventPayload<T>, condition?: (events: readonly RunEvent[]) => boolean): void {
    const event = condition ? this.writer.append(type, payload, condition) : this.writer.append(type, payload);
    if (event) this.state = reduceRunEvent(this.state, event);
  }
}

export function inputFingerprints(policyId: string): RunConfig["inputs"] {
  if (!/^[a-zA-Z0-9][\w.-]*$/.test(policyId)) throw new Error(`invalid policy id: ${policyId}`);
  const dir = path.join(POLICIES_DIR, policyId);
  const hashFile = (name: string): string => createHash("sha256").update(readFileSync(path.join(dir, name))).digest("hex");
  return {
    policySha256: hashFile("policy.json"),
    referenceSha256: existsSync(path.join(dir, "reference.json")) ? hashFile("reference.json") : null,
    folkSha256: existsSync(path.join(dir, "folk.json")) ? hashFile("folk.json") : null,
  };
}

export function createStageContext(recorder: RunRecorder, config: RunConfig, gateway: Gateway, original?: PolicyVersion): StageContext {
  const policy = loadPolicyPackage(config.policyId);
  return {
    runId: recorder.writer.runId, config, gateway,
    policy: original ? { ...policy, surfaces: original.surfaces } : policy,
    reference: loadReference(config.policyId), folk: loadFolk(config.policyId),
    emitThreadItem: (record) => recorder.emit("thread.item", { record }),
    log: (level, message) => recorder.emit("log", { level, message }),
  };
}

export function logProvenance(recorder: RunRecorder, gateway: Gateway): void {
  recorder.emit("log", { level: "info", message: `Backends: bulk=${gateway.backends.bulk}, agent=${gateway.backends.agent}` });
  recorder.emit("log", { level: "info", message: `Decisions: ${gateway.hasApiKey ? "real" : "EMULATED (no API key)"}` });
  recorder.emit("log", { level: "info", message: `Embeddings: ${gateway.hasApiKey ? "yes" : "no"}` });
}

export function cohort(readings: Reading[], version: number, tag: string | null = null): Reading[] {
  return readings.filter((r) => r.policyVersion === version && r.id === `r-${r.scenarioId}-v${version}${tag === null ? "" : `-${tag}`}`);
}

export interface PairedReadings {
  before: Reading[];
  after: Reading[];
  scenarioIds: string[];
}

export function pairedCohorts(before: Reading[], after: Reading[]): PairedReadings {
  const byScenario = new Map(after.map((reading) => [reading.scenarioId, reading]));
  const pairs: PairedReadings = { before: [], after: [], scenarioIds: [] };
  for (const reading of before) {
    const other = byScenario.get(reading.scenarioId);
    if (!other) continue;
    pairs.before.push(reading);
    pairs.after.push(other);
    pairs.scenarioIds.push(reading.scenarioId);
  }
  return pairs;
}

export function scenarioIdsByFinding(findings: Finding[], readings: Reading[]): Record<string, string[]> {
  const byId = new Map(readings.map((reading) => [reading.id, reading.scenarioId]));
  return Object.fromEntries(findings.map((finding) => [finding.id, [...new Set([
    ...finding.evidence.scenarioIds,
    ...finding.evidence.readingIds.flatMap((id) => { const scenarioId = byId.get(id); return scenarioId ? [scenarioId] : []; }),
  ])]]));
}

/** Failed readers are logged immediately, without aborting other in-flight readers. */
export async function readBatch(ctx: StageContext, recorder: RunRecorder, version: PolicyVersion, scenarios: Scenario[], tag: string | null, fresh: boolean): Promise<Reading[]> {
  const settled = await Promise.allSettled(scenarios.map(async (scenario) => {
    try {
      const reading = await readScenario(ctx, { scenario, version, tag, fresh });
      recorder.emit("reading.completed", { reading });
      return reading;
    } catch (error) {
      recorder.emit("reading.failed", { scenarioId: scenario.id, policyVersion: version.version, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }));
  const readings = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  if (readings.length === 0) throw new Error(`no successful readings for policy v${version.version}`);
  return readings;
}

function mergeLevels(dimensions: Dimension[], decision: AllocationDecision): Dimension[] {
  const merged = dimensions.map((dimension) => ({ ...dimension, levels: [...dimension.levels] }));
  for (const entry of decision.newLevels) {
    const dimension = merged.find((d) => d.id === entry.dimId);
    if (!dimension) throw new Error(`reviewer added a level to unknown dimension ${entry.dimId}`);
    if (!entry.level.id.trim() || dimension.levels.some((level) => level.id === entry.level.id)) throw new Error(`reviewer added an invalid or duplicate level ${entry.dimId}/${entry.level.id}`);
    dimension.levels.push(entry.level);
  }
  return merged.map((dimension) => Dimension.parse(dimension));
}

export async function runWindTunnel(args: { runId: string; config: RunConfig }): Promise<void> {
  const config = RunConfig.parse({ ...args.config, inputs: inputFingerprints(args.config.policyId) });
  const recorder = new RunRecorder(args.runId, [], true);
  const gateway = new Gateway();
  let reviewer: Reviewer | null = null;
  let failed = false;
  let failure: unknown;
  let summary = "";
  try {
    recorder.emit("run.started", { config });
    logProvenance(recorder, gateway);
    const ctx = createStageContext(recorder, config, gateway);
    if (config.mode === "retest") throw new Error("retest runs require retestEdit and edited surfaces");
    if (ctx.reference === null && config.mode === "full") ctx.log("warn", "no reference: conflict metrics are not meaningful");
    const v0 = versionZero(ctx.policy);
    recorder.emit("policy.version", { policy: v0 });
    recorder.emit("dims.extracted", { dimensions: await extractDimensions(ctx, v0) });
    const history: Array<{ batch: number; readingsSoFar: number; clusters: Cluster[] }> = [];
    const exploreBatch = async (scenarios: Scenario[], batch: number): Promise<void> => {
      for (const scenario of scenarios) recorder.emit("scenario.created", { scenario });
      const readings = await readBatch(ctx, recorder, v0, scenarios, null, config.fresh);
      recorder.emit("grades.added", { grades: await gradeReadings(ctx, v0, readings) });
      const all = cohort(recorder.state.readings, 0);
      const clusters = await clusterInterpretations(ctx, { version: v0, readings: all, grades: recorder.state.grades, idPrefix: `c-v0-b${batch}` });
      recorder.emit("clusters.updated", { policyVersion: 0, clusters });
      recorder.emit("codings.added", { policyVersion: 0, codebookVersion: 0, codings: await codeReadings(ctx, { readings: all, codebook: clusters }) });
      history.push({ batch, readingsSoFar: all.length, clusters });
    };
    const seedRows = coveringArray(recorder.state.dimensions, config.seedSize, config.seed);
    ctx.log("info", `Pairwise seed size: ${seedRows.length} (requested minimum ${config.seedSize}; exploration budget ${config.budget}).`);
    if (seedRows.length > config.budget) throw new Error(`budget ${config.budget} cannot fit the ${seedRows.length}-row pairwise seed suite`);
    await exploreBatch(await writeScenarios(ctx, { version: v0, dimensions: recorder.state.dimensions, rows: seedRows, batch: 0, origin: "seed", allocationReason: null, firstIndex: 1 }), 0);
    let batch = 1;
    while (recorder.state.scenarios.length < config.budget) {
      reviewer ??= await createReviewer(ctx);
      const readings = cohort(recorder.state.readings, 0);
      const split = splitTable({ dimensions: recorder.state.dimensions, scenarios: recorder.state.scenarios, readings, grades: recorder.state.grades, codings: recorder.state.codings, threshold: DEFAULT_CONFLICT_THRESHOLD, permutations: 200, seed: config.seed + batch });
      ctx.log("info", `Reader homogeneity: ${homogeneity(readings).toFixed(3)}`);
      const remainingBudget = config.budget - recorder.state.scenarios.length;
      const proposed = await reviewer.decide({ batch, remainingBudget, batchSize: config.batchSize, dimensions: recorder.state.dimensions, split, discovery: discoveryCurve(history), clusters: recorder.state.clusters.filter((c) => c.policyVersion === 0), readings, scenarios: recorder.state.scenarios });
      const decision: AllocationDecision = { ...proposed, batch, n: Math.min(proposed.n, remainingBudget) };
      recorder.emit("allocation.decided", { decision });
      if (decision.stopExploring || decision.n === 0) break;
      if (decision.newLevels.length) recorder.emit("dims.extracted", { dimensions: mergeLevels(recorder.state.dimensions, decision) });
      const rows = rowsForDecision(recorder.state.dimensions, decision, config.seed + batch).slice(0, decision.n);
      if (rows.length === 0) throw new Error("allocation produced no scenarios");
      await exploreBatch(await writeScenarios(ctx, { version: v0, dimensions: recorder.state.dimensions, rows, batch, origin: "adaptive", allocationReason: decision.rationale, firstIndex: recorder.state.scenarios.length + 1 }), batch);
      batch += 1;
    }
    const originalReadings = cohort(recorder.state.readings, 0);
    const codebook = await clusterInterpretations(ctx, { version: v0, readings: originalReadings, grades: recorder.state.grades, idPrefix: "cb0" });
    recorder.emit("clusters.updated", { policyVersion: 0, clusters: codebook });
    recorder.emit("codebook.fixed", { codebookVersion: 0, clusterIds: codebook.map((c) => c.id) });
    recorder.emit("codings.added", { policyVersion: 0, codebookVersion: 0, codings: await codeReadings(ctx, { readings: originalReadings, codebook }) });
    if (config.mode === "explore") {
      summary = `${recorder.state.scenarios.length} scenarios, ${originalReadings.length} readings, ${codebook.length} frozen beliefs; exploration complete.`;
    } else {
      const split = splitTable({ dimensions: recorder.state.dimensions, scenarios: recorder.state.scenarios, readings: originalReadings, grades: recorder.state.grades, codings: recorder.state.codings, threshold: DEFAULT_CONFLICT_THRESHOLD, permutations: 200, seed: config.seed });
      const drafts = await draftFindings(ctx, { version: v0, clusters: codebook, readings: originalReadings, scenarios: recorder.state.scenarios, grades: recorder.state.grades, codings: recorder.state.codings, dimensions: recorder.state.dimensions, split });
      recorder.emit("findings.updated", { findings: await Promise.all(drafts.map((draft) => classifyByRepair(ctx, v0, draft, { scenarios: recorder.state.scenarios, codebook, readings: originalReadings, codings: recorder.state.codings }))) });
      const retestReadings = await readBatch(ctx, recorder, v0, recorder.state.scenarios, "rt", true);
      recorder.emit("grades.added", { grades: await gradeReadings(ctx, v0, retestReadings) });
      recorder.emit("codings.added", { policyVersion: 0, codebookVersion: 0, codings: await codeReadings(ctx, { readings: retestReadings, codebook }) });
      const aIds = new Set(originalReadings.map((r) => r.scenarioId));
      const bIds = new Set(retestReadings.map((r) => r.scenarioId));
      const pairedA = originalReadings.filter((r) => bIds.has(r.scenarioId));
      const pairedB = retestReadings.filter((r) => aIds.has(r.scenarioId));
      const noise = noiseBand({ readings: pairedA, grades: recorder.state.grades }, { readings: pairedB, grades: recorder.state.grades }, DEFAULT_CONFLICT_THRESHOLD);
      const findingScenarios = scenarioIdsByFinding(recorder.state.findings, recorder.state.readings);
      const findingNoise = reproductionNoise(recorder.state.findings, findingScenarios, { readings: pairedA, codings: recorder.state.codings }, { readings: pairedB, codings: recorder.state.codings });
      const initial = iterationMetrics({ version: 0, readings: originalReadings, grades: recorder.state.grades, codings: recorder.state.codings, findings: recorder.state.findings, scenarioIdsByFinding: findingScenarios, noiseBand: noise.band, noiseBandScenarios: noise.pairedScenarios, reproductionNoise: findingNoise, threshold: DEFAULT_CONFLICT_THRESHOLD, seed: config.seed });
      let decision = stopDecision({ history: [], current: initial, iterationIndex: 0, maxIterations: config.maxIterations, fidelityFailures: 0 });
      recorder.emit("iteration.completed", { iteration: { ...initial, ...decision } });
      let currentVersion = v0;
      let finalVersion = v0;
      let stopReason = decision.reason;
      let feedback: FidelityResult | null = null;
      for (let i = 1; i <= config.maxIterations && decision.decision === "continue"; i++) {
        let rejected: RewriteCandidate | null = null;
        let accepted: RewriteCandidate | null = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          const candidate = await rewritePolicy(ctx, { version: currentVersion, findings: recorder.state.findings, nextVersion: i, feedback, rejected });
          const fidelity = await checkFidelity(ctx, { original: v0, candidate: candidate.surfaces });
          recorder.emit("rewrite.proposed", { rewrite: { fromVersion: currentVersion.version, toVersion: i, edits: candidate.edits, fidelity } });
          if (fidelity.passed) { accepted = candidate; feedback = null; break; }
          feedback = fidelity;
          rejected = candidate;
        }
        if (accepted === null) { stopReason = "Fidelity gate failed twice; previous policy retained."; break; }
        currentVersion = makeVersion(config.policyId, i, currentVersion.version, accepted.surfaces);
        recorder.emit("policy.version", { policy: currentVersion });
        const readings = await readBatch(ctx, recorder, currentVersion, recorder.state.scenarios, null, config.fresh);
        recorder.emit("grades.added", { grades: await gradeReadings(ctx, currentVersion, readings) });
        recorder.emit("codings.added", { policyVersion: i, codebookVersion: 0, codings: await codeReadings(ctx, { readings, codebook }) });
        recorder.emit("clusters.updated", { policyVersion: i, clusters: await clusterInterpretations(ctx, { version: currentVersion, readings, grades: recorder.state.grades, idPrefix: `c-v${i}` }) });
        const previous = recorder.state.iterations.at(-1);
        if (!previous) throw new Error("rewrite comparison is missing its previous iteration");
        const pairs = pairedCohorts(cohort(recorder.state.readings, previous.policyVersion), readings);
        const pairedIds = new Set(pairs.scenarioIds);
        const comparisonNoise = noiseBand(
          { readings: originalReadings.filter((reading) => pairedIds.has(reading.scenarioId)), grades: recorder.state.grades },
          { readings: retestReadings.filter((reading) => pairedIds.has(reading.scenarioId)), grades: recorder.state.grades },
          DEFAULT_CONFLICT_THRESHOLD,
        );
        const comparisonFindingNoise = reproductionNoise(
          recorder.state.findings, findingScenarios,
          { readings: originalReadings.filter((reading) => pairedIds.has(reading.scenarioId)), codings: recorder.state.codings },
          { readings: retestReadings.filter((reading) => pairedIds.has(reading.scenarioId)), codings: recorder.state.codings },
        );
        const previousMetrics = iterationMetrics({ version: previous.policyVersion, readings: pairs.before, grades: recorder.state.grades, codings: recorder.state.codings, findings: recorder.state.findings, scenarioIdsByFinding: findingScenarios, noiseBand: comparisonNoise.band, noiseBandScenarios: comparisonNoise.pairedScenarios, reproductionNoise: comparisonFindingNoise, threshold: DEFAULT_CONFLICT_THRESHOLD, seed: config.seed });
        const metrics = iterationMetrics({ version: i, readings: pairs.after, grades: recorder.state.grades, codings: recorder.state.codings, findings: recorder.state.findings, scenarioIdsByFinding: findingScenarios, noiseBand: comparisonNoise.band, noiseBandScenarios: comparisonNoise.pairedScenarios, reproductionNoise: comparisonFindingNoise, threshold: DEFAULT_CONFLICT_THRESHOLD, seed: config.seed });
        ctx.log("info", `Version comparison v${previous.policyVersion} → v${i}: ${pairs.after.length} paired scenarios; conflict ${previousMetrics.conflictRate.toFixed(3)} → ${metrics.conflictRate.toFixed(3)}; ${comparisonNoise.pairedScenarios} noise pairs.`);
        const comparisonHistory = [...recorder.state.iterations.slice(0, -1), { ...previousMetrics, decision: previous.decision, reason: previous.reason }];
        decision = stopDecision({ history: comparisonHistory, current: metrics, iterationIndex: i, maxIterations: config.maxIterations, fidelityFailures: 0 });
        if (pairs.after.length < 5 || comparisonNoise.pairedScenarios < 5) {
          decision = { decision: "stop", reason: `Inconclusive comparison: ${pairs.after.length} paired scenarios and ${comparisonNoise.pairedScenarios} noise pairs (minimum 5); previous policy retained.` };
        } else if (metrics.conflictRate - previousMetrics.conflictRate > comparisonNoise.band + Number.EPSILON) {
          decision = { decision: "stop", reason: "Conflict rate regressed beyond the noise band on identical scenarios; previous policy retained." };
        } else finalVersion = currentVersion;
        recorder.emit("iteration.completed", { iteration: { ...metrics, ...decision } });
        stopReason = decision.reason;
      }
      recorder.emit("stop.decided", { finalVersion: finalVersion.version, reason: stopReason });
      // Baselines: `baselineRuns` gpt-6.1-sol replicates plus one gpt-6-astra comparator; none when baselineRuns = 0.
      for (let i = 1; i <= config.baselineRuns; i++) {
        recorder.emit("baseline.completed", { run: await runBaseline(ctx, v0, { id: `baseline-${i}`, model: "gpt-6.1-sol", effort: "high" }) });
      }
      if (config.baselineRuns > 0) {
        recorder.emit("baseline.completed", { run: await runBaseline(ctx, v0, { id: "baseline-astra", model: "gpt-6-astra", effort: "high" }) });
      }
      const sentenceText = new Map(v0.sentences.map((sentence) => [sentence.id, sentence.text]));
      const score = await scoreAgainstHoldout(ctx, { version: v0, seed: config.seed, systems: [
        { id: "wind-tunnel", label: "Wind tunnel", items: recorder.state.findings.map((finding) => {
          const passages = finding.sentenceIds.flatMap((id) => {
            const text = sentenceText.get(id);
            return text ? [`Source sentence: ${text}`] : [];
          });
          if (!passages.length) {
            const interpretationIds = new Set(codebook.filter((cluster) => finding.evidence.clusterIds.includes(cluster.id)).flatMap((cluster) => cluster.interpretationIds));
            for (const reading of originalReadings) {
              if (!finding.evidence.readingIds.includes(reading.id)) continue;
              for (const interpretation of reading.interpretations) {
                if (interpretationIds.has(interpretation.id) && interpretation.quote.trim()) passages.push(`Reader quote: ${interpretation.quote}`);
              }
            }
          }
          return { id: finding.id, text: `${[...new Set(passages)].join("\n") || "(No specific sentence or quote cited.)"}\n${finding.title}: ${finding.readingSummary}` };
        }) },
        ...recorder.state.baselines.map((baseline) => ({ id: baseline.id, label: `${baseline.model} (${baseline.id})`, items: baseline.issues.map((issue) => ({ id: issue.id, text: `${issue.sentenceQuote}\n${issue.issue}: ${issue.why}` })) })),
      ] });
      if (score) recorder.emit("score.completed", { score });
      else ctx.log("warn", "No holdout is available; scoring skipped.");
      try {
        for (const question of await humanQuestions(ctx, v0, recorder.state.findings)) recorder.emit("human.question", { question });
      } catch (error) { ctx.log("warn", `Human questions failed: ${error instanceof Error ? error.message : String(error)}`); }
      try {
        const result = await runProbe(ctx, { readings: originalReadings, assumptions: DEFAULT_ASSUMPTIONS, days: 180 });
        if (result) recorder.emit("probe.completed", { result });
        else ctx.log("info", "No incentive was evidenced; hypothetical probe skipped.");
      } catch (error) { ctx.log("warn", `Probe failed: ${error instanceof Error ? error.message : String(error)}`); }
      const finalPairs = pairedCohorts(originalReadings, cohort(recorder.state.readings, finalVersion.version));
      const beforeRate = conflictRate(finalPairs.before, recorder.state.grades, DEFAULT_CONFLICT_THRESHOLD);
      const afterRate = conflictRate(finalPairs.after, recorder.state.grades, DEFAULT_CONFLICT_THRESHOLD);
      summary = `${recorder.state.scenarios.length} scenarios, ${recorder.state.findings.length} findings (${recorder.state.findings.filter((f) => f.class === "wording_fix").length} wording fixes); final v${finalVersion.version}; conflict rate ${beforeRate.toFixed(3)} → ${afterRate.toFixed(3)} on ${finalPairs.after.length} paired scenarios; noise band ${noise.band.toFixed(3)} (${noise.pairedScenarios} noise pairs); ${recorder.state.baselines.length} baselines.`;
    }
  } catch (error) { failed = true; failure = error; }
  finally {
    for (const close of [() => reviewer?.close(), () => gateway.close()]) {
      try { await close(); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  }
  if (failed) {
    recorder.emit("run.failed", { error: failure instanceof Error ? failure.message : String(failure) });
    throw failure;
  }
  recorder.emit("run.completed", { summary });
}
