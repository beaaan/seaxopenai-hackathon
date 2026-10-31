import { Gateway } from "../core/llm/gateway";
import { makeVersion } from "../core/policy";
import { readEvents } from "../core/store";
import { Surface, type Iteration, type SuiteComparison } from "../shared/schema";
import { DEFAULT_CONFLICT_THRESHOLD, gradeReadings } from "../reviewer/grade";
import { codeReadings } from "../reviewer/code";
import { iterationMetrics, noiseBand } from "../reviewer/metrics";
import { compareSuite } from "./suite";
import { RunRecorder, cohort, createStageContext, logProvenance, readBatch, rebuildRunState, scenarioIdsByFinding } from "./run";

export async function retestEdit(args: { runId: string; suiteRunId: string; surfaces: Surface[]; smoke: boolean }): Promise<SuiteComparison> {
  const surfaces = Surface.array().min(1).parse(args.surfaces);
  const suite = rebuildRunState(readEvents(args.suiteRunId));
  const lastIteration = suite.iterations.at(-1);
  if (!suite.config || !lastIteration) throw new Error(`run ${args.suiteRunId} has no completed suite iteration`);
  const baseVersion = suite.finalVersion ?? lastIteration.policyVersion;
  const basePolicy = suite.policies.find((policy) => policy.version === baseVersion);
  const v0 = suite.policies.find((policy) => policy.version === 0);
  if (!basePolicy || !v0) throw new Error(`suite ${args.suiteRunId} is missing its policy versions`);
  const config = { ...suite.config, mode: "retest" as const, suiteRunId: args.suiteRunId, fresh: true };
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
  const recorder = new RunRecorder(args.runId, [], true);
  const gateway = new Gateway();
  let failed = false;
  let failure: unknown;
  let comparison: SuiteComparison | null = null;
  try {
    recorder.emit("run.started", { config });
    logProvenance(recorder, gateway);
    const ctx = createStageContext(recorder, config, gateway);
    recorder.emit("policy.version", { policy: v0 });
    if (baseVersion !== 0) recorder.emit("policy.version", { policy: basePolicy });
    recorder.emit("policy.version", { policy: version });
    recorder.emit("dims.extracted", { dimensions: suite.dimensions });
    for (const scenario of scenarios) recorder.emit("scenario.created", { scenario });
    recorder.emit("clusters.updated", { policyVersion: 0, clusters: suite.codebook });
    recorder.emit("codebook.fixed", { codebookVersion: 0, clusterIds: suite.codebook.map((cluster) => cluster.id) });
    // Preserve source measurements so this run can itself serve as a future suite.
    const sourceReadings = suite.readings.filter((reading) => scenarioIds.has(reading.scenarioId) && (reading.policyVersion === 0 || beforeReadings.some((before) => before.id === reading.id)));
    const sourceIds = new Set(sourceReadings.map((reading) => reading.id));
    for (const reading of sourceReadings) recorder.emit("reading.completed", { reading });
    recorder.emit("grades.added", { grades: suite.grades.filter((grade) => sourceIds.has(grade.readingId)) });
    for (const policyVersion of new Set(sourceReadings.map((reading) => reading.policyVersion))) {
      const versionReadingIds = new Set(sourceReadings.filter((reading) => reading.policyVersion === policyVersion).map((reading) => reading.id));
      recorder.emit("codings.added", { policyVersion, codebookVersion: 0, codings: suite.codings.filter((coding) => versionReadingIds.has(coding.readingId) && frozenIds.has(coding.clusterId)) });
    }
    recorder.emit("findings.updated", { findings: suite.findings });
    const readings = await readBatch(ctx, recorder, version, scenarios, null, true);
    if (readings.length !== scenarios.length) throw new Error("retest is incomplete: some selected readers failed");
    const grades = await gradeReadings(ctx, version, readings);
    recorder.emit("grades.added", { grades });
    const codings = await codeReadings(ctx, { readings, codebook: suite.codebook });
    recorder.emit("codings.added", { policyVersion: version.version, codebookVersion: 0, codings });
    const a = cohort(suite.readings, 0).filter((reading) => scenarioIds.has(reading.scenarioId));
    const b = cohort(suite.readings, 0, "rt").filter((reading) => scenarioIds.has(reading.scenarioId));
    const aIds = new Set(a.map((reading) => reading.scenarioId));
    const bIds = new Set(b.map((reading) => reading.scenarioId));
    const pairedA = a.filter((reading) => bIds.has(reading.scenarioId));
    const pairedB = b.filter((reading) => aIds.has(reading.scenarioId));
    const originalIteration = suite.iterations.find((iteration) => iteration.policyVersion === 0) ?? lastIteration;
    const noise = pairedA.length > 0
      ? noiseBand({ readings: pairedA, grades: suite.grades }, { readings: pairedB, grades: suite.grades }, DEFAULT_CONFLICT_THRESHOLD)
      : { band: originalIteration.noiseBand, pairedScenarios: originalIteration.noiseBandScenarios };
    if (noise.band === null) throw new Error("suite has no measured noise band");
    const subsetFindingScenarios = Object.fromEntries(Object.entries(findingScenarios).map(([findingId, ids]) => [findingId, ids.filter((id) => scenarioIds.has(id))]));
    const before: Iteration = {
      ...iterationMetrics({ version: baseVersion, readings: beforeReadings, grades: suite.grades, codings: suite.codings, findings: suite.findings, scenarioIdsByFinding: subsetFindingScenarios, noiseBand: noise.band, noiseBandScenarios: noise.pairedScenarios, threshold: DEFAULT_CONFLICT_THRESHOLD, seed: config.seed }),
      decision: "stop", reason: "Suite baseline recomputed on the selected scenarios.",
    };
    const after: Iteration = {
      ...iterationMetrics({ version: version.version, readings, grades, codings, findings: suite.findings, scenarioIdsByFinding: subsetFindingScenarios, noiseBand: noise.band, noiseBandScenarios: noise.pairedScenarios, threshold: DEFAULT_CONFLICT_THRESHOLD, seed: config.seed }),
      decision: "stop", reason: "Edited text tested against the frozen suite.",
    };
    comparison = { suiteRunId: args.suiteRunId, baseVersion, before, after, ...compareSuite({ before, after, noiseBand: noise.band }) };
    recorder.emit("iteration.completed", { iteration: after });
    recorder.emit("suite.compared", { comparison });
    recorder.emit("stop.decided", { finalVersion: comparison.passed ? version.version : baseVersion, reason: comparison.passed ? "Suite passed." : comparison.regressions.join("; ") });
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
  recorder.emit("run.completed", { summary: `${comparison.passed ? "PASS" : "FAIL"}: ${scenarios.length} scenarios; conflict rate ${comparison.before.conflictRate.toFixed(3)} → ${comparison.after.conflictRate.toFixed(3)} (noise band ${comparison.after.noiseBand?.toFixed(3)}). ${comparison.regressions.join("; ")}` });
  return comparison;
}
