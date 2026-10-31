import { Gateway } from "../core/llm/gateway";
import { config as runtimeConfig } from "../core/env";
import { makeVersion } from "../core/policy";
import { readEvents } from "../core/store";
import { Surface, type Iteration, type PolicyVersion, type Reading, type RunConfig, type Scenario, type SuiteComparison } from "../shared/schema";
import { DEFAULT_CONFLICT_THRESHOLD, gradeReadings } from "../reviewer/grade";
import { codeReadings } from "../reviewer/code";
import { iterationMetrics, noiseBand } from "../reviewer/metrics";
import { compareSuite } from "./suite";
import { RunRecorder, cohort, createStageContext, inputFingerprints, logProvenance, pairedCohorts, readBatch, rebuildRunState, scenarioIdsByFinding, type RunState } from "./run";

export interface RetestPreflight {
  suite: RunState;
  config: RunConfig;
  v0: PolicyVersion;
  basePolicy: PolicyVersion;
  version: PolicyVersion;
  scenarios: Scenario[];
  beforeReadings: Reading[];
  findingScenarios: Record<string, string[]>;
}

/** Disk-only validation, shared by the API before spawning and the CLI before model calls. */
export function preflightRetest(args: { suiteRunId: string; surfaces: Surface[]; smoke: boolean }): RetestPreflight {
  const surfaces = Surface.array().min(1).parse(args.surfaces);
  const events = readEvents(args.suiteRunId);
  const lifecycle = events.findLast((event) => event.type === "run.started" || event.type === "run.completed" || event.type === "run.failed");
  if (lifecycle?.type !== "run.completed") throw new Error(`suite ${args.suiteRunId} is not completed`);
  const suite = rebuildRunState(events);
  const lastIteration = suite.iterations.at(-1);
  if (!suite.config || !lastIteration) throw new Error(`run ${args.suiteRunId} has no completed suite iteration`);
  const baseVersion = suite.finalVersion ?? lastIteration.policyVersion;
  const basePolicy = suite.policies.find((policy) => policy.version === baseVersion);
  const v0 = suite.policies.find((policy) => policy.version === 0);
  if (!basePolicy || !v0) throw new Error(`suite ${args.suiteRunId} is missing its policy versions`);
  if (!events.some((event) => event.type === "codebook.fixed")) throw new Error(`suite ${args.suiteRunId} has no frozen codebook`);
  const inputs = inputFingerprints(suite.config.policyId);
  if (inputs.referenceSha256 !== suite.config.inputs.referenceSha256) throw new Error(`reference.json changed since suite ${args.suiteRunId}; create a new suite before retesting`);
  if (inputs.folkSha256 !== suite.config.inputs.folkSha256) throw new Error(`folk.json changed since suite ${args.suiteRunId}; create a new suite before retesting`);
  const decisions = events.findLast((event) => event.type === "log" && event.payload.message.startsWith("Decisions: "));
  const embeddings = events.findLast((event) => event.type === "log" && event.payload.message.startsWith("Embeddings: "));
  if (decisions?.type !== "log" || embeddings?.type !== "log") throw new Error(`suite ${args.suiteRunId} lacks Decisions/embeddings provenance; create a new suite`);
  const hasKey = runtimeConfig.openaiApiKey !== null && runtimeConfig.openaiApiKey !== "";
  if (decisions.payload.message !== `Decisions: ${hasKey ? "real" : "EMULATED (no API key)"}`) throw new Error(`Decisions provenance differs from suite ${args.suiteRunId}; real and EMULATED measurements cannot be compared`);
  if (embeddings.payload.message !== `Embeddings: ${hasKey ? "yes" : "no"}`) throw new Error(`embeddings availability differs from suite ${args.suiteRunId}; create a new suite`);
  const config: RunConfig = { ...suite.config, inputs, mode: "retest", suiteRunId: args.suiteRunId, fresh: true };
  const findingScenarios = scenarioIdsByFinding(suite.findings, suite.readings);
  const evidenceIds = new Set(Object.values(findingScenarios).flat());
  const ordered = [...suite.scenarios].sort((a, b) => {
    const evidenceOrder = Number(evidenceIds.has(b.id)) - Number(evidenceIds.has(a.id));
    return (args.smoke ? evidenceOrder : 0) || a.id.localeCompare(b.id, "en", { numeric: true });
  });
  const scenarios = args.smoke ? ordered.slice(0, config.smokeSize) : ordered;
  if (!scenarios.length) throw new Error(`suite ${args.suiteRunId} has no scenarios`);
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
  const beforeReadings = cohort(suite.readings, baseVersion).filter((reading) => scenarioIds.has(reading.scenarioId));
  if (beforeReadings.length !== scenarios.length) throw new Error(`suite v${baseVersion} is missing readings for the selected scenarios`);
  const frozenIds = new Set(suite.codebook.map((cluster) => cluster.id));
  if (suite.findings.some((finding) => finding.evidence.clusterIds.some((id) => !frozenIds.has(id)))) throw new Error("suite findings do not match its frozen codebook");
  const version = makeVersion(config.policyId, Math.max(...suite.policies.map((policy) => policy.version)) + 1, baseVersion, surfaces);
  return { suite, config, v0, basePolicy, version, scenarios, beforeReadings, findingScenarios };
}

export async function retestEdit(args: { runId: string; suiteRunId: string; surfaces: Surface[]; smoke: boolean }): Promise<SuiteComparison> {
  const { suite, config, v0, basePolicy, version, scenarios, beforeReadings, findingScenarios } = preflightRetest(args);
  const baseVersion = basePolicy.version;
  const scenarioIds = new Set(scenarios.map((scenario) => scenario.id));
  const frozenIds = new Set(suite.codebook.map((cluster) => cluster.id));
  const recorder = new RunRecorder(args.runId, [], true);
  const gateway = new Gateway();
  let failed = false;
  let failure: unknown;
  let comparison: SuiteComparison | null = null;
  try {
    recorder.emit("run.started", { config });
    logProvenance(recorder, gateway);
    const ctx = createStageContext(recorder, config, gateway, v0);
    recorder.emit("policy.version", { policy: v0 });
    if (baseVersion !== 0) recorder.emit("policy.version", { policy: basePolicy });
    recorder.emit("policy.version", { policy: version });
    recorder.emit("dims.extracted", { dimensions: suite.dimensions });
    for (const scenario of scenarios) recorder.emit("scenario.created", { scenario });
    recorder.emit("clusters.updated", { policyVersion: 0, clusters: suite.codebook });
    recorder.emit("codebook.fixed", { codebookVersion: 0, clusterIds: suite.codebook.map((cluster) => cluster.id) });
    // Preserve source measurements so this run can itself serve as a future suite.
    const beforeIds = new Set(beforeReadings.map((reading) => reading.id));
    const sourceReadings = suite.readings.filter((reading) => scenarioIds.has(reading.scenarioId) && (reading.policyVersion === 0 || beforeIds.has(reading.id)));
    const sourceIds = new Set(sourceReadings.map((reading) => reading.id));
    for (const reading of sourceReadings) recorder.emit("reading.completed", { reading });
    recorder.emit("grades.added", { grades: suite.grades.filter((grade) => sourceIds.has(grade.readingId)) });
    for (const policyVersion of new Set(sourceReadings.map((reading) => reading.policyVersion))) {
      const versionReadingIds = new Set(sourceReadings.filter((reading) => reading.policyVersion === policyVersion).map((reading) => reading.id));
      recorder.emit("codings.added", { policyVersion, codebookVersion: 0, codings: suite.codings.filter((coding) => versionReadingIds.has(coding.readingId) && frozenIds.has(coding.clusterId)) });
    }
    recorder.emit("findings.updated", { findings: suite.findings });
    const readings = await readBatch(ctx, recorder, version, scenarios, null, true);
    const grades = await gradeReadings(ctx, version, readings);
    recorder.emit("grades.added", { grades });
    const codings = await codeReadings(ctx, { readings, codebook: suite.codebook });
    recorder.emit("codings.added", { policyVersion: version.version, codebookVersion: 0, codings });
    const pairs = pairedCohorts(
      cohort(suite.readings, 0).filter((reading) => scenarioIds.has(reading.scenarioId)),
      cohort(suite.readings, 0, "rt").filter((reading) => scenarioIds.has(reading.scenarioId)),
    );
    // Empty/sub-five subsets remain explicitly inconclusive, never borrow parent coverage.
    const noise = noiseBand({ readings: pairs.before, grades: suite.grades }, { readings: pairs.after, grades: suite.grades }, DEFAULT_CONFLICT_THRESHOLD);
    const subsetFindingScenarios = Object.fromEntries(Object.entries(findingScenarios).map(([findingId, ids]) => [findingId, ids.filter((id) => scenarioIds.has(id))]));
    const before: Iteration = {
      ...iterationMetrics({ version: baseVersion, readings: beforeReadings, grades: suite.grades, codings: suite.codings, findings: suite.findings, scenarioIdsByFinding: subsetFindingScenarios, noiseBand: noise.band, noiseBandScenarios: noise.pairedScenarios, threshold: DEFAULT_CONFLICT_THRESHOLD, seed: config.seed }),
      decision: "stop", reason: "Suite baseline recomputed on the selected scenarios.",
    };
    const after: Iteration = {
      ...iterationMetrics({ version: version.version, readings, grades, codings, findings: suite.findings, scenarioIdsByFinding: subsetFindingScenarios, noiseBand: noise.band, noiseBandScenarios: noise.pairedScenarios, threshold: DEFAULT_CONFLICT_THRESHOLD, seed: config.seed }),
      decision: "stop", reason: "Edited text tested against the frozen suite.",
    };
    const result = compareSuite({ before, after, noiseBand: noise.band });
    after.reason = result.verdict === "pass" ? "Frozen suite passed." : result.reasons.join("; ");
    comparison = { suiteRunId: args.suiteRunId, baseVersion, before, after, ...result };
    recorder.emit("iteration.completed", { iteration: after });
    recorder.emit("suite.compared", { comparison });
    recorder.emit("stop.decided", { finalVersion: comparison.verdict === "pass" ? version.version : baseVersion, reason: after.reason });
  } catch (error) { failed = true; failure = error; }
  finally {
    try { await gateway.close(); }
    catch (error) { if (!failed) { failed = true; failure = error; } }
  }
  if (failed || comparison === null) {
    const error = failed ? failure : new Error("retest did not produce a comparison");
    recorder.emit("run.failed", { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
  recorder.emit("run.completed", { summary: `${comparison.verdict.toUpperCase()}: ${scenarios.length} scenarios; conflict rate ${comparison.before.conflictRate.toFixed(3)} → ${comparison.after.conflictRate.toFixed(3)} (noise band ${comparison.after.noiseBand?.toFixed(3)}; ${comparison.after.noiseBandScenarios} noise pairs). ${comparison.reasons.join("; ")}` });
  return comparison;
}
