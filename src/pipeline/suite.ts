import type { Iteration, SuiteComparison } from "../shared/schema";

export type SuiteResult = Pick<SuiteComparison, "verdict" | "reasons">;

/** Compare identical scenario cohorts; missing measurements can never constitute a pass. */
export function compareSuite(args: { before: Iteration; after: Iteration; noiseBand: number }): SuiteResult {
  const { before, after, noiseBand } = args;
  const reasons: string[] = [];
  if (before.noiseBandScenarios === null || after.noiseBandScenarios === null || before.noiseBandScenarios < 5 || after.noiseBandScenarios < 5) {
    reasons.push(`inconclusive noise band: ${before.noiseBandScenarios ?? "unknown"}/${after.noiseBandScenarios ?? "unknown"} paired scenarios (minimum 5)`);
  }
  if (before.readings < 5 || before.readings !== after.readings) {
    reasons.push(`inconclusive scenario coverage: ${before.readings} before and ${after.readings} after (identical cohorts of at least 5 required)`);
  }
  const previous = new Map(before.findingReproduction.map((finding) => [finding.findingId, finding]));
  const current = new Map(after.findingReproduction.map((finding) => [finding.findingId, finding]));
  for (const findingId of new Set([...previous.keys(), ...current.keys()])) {
    const a = previous.get(findingId);
    const b = current.get(findingId);
    if (!a || !b || a.n === 0 || b.n === 0) {
      reasons.push(`finding ${findingId} unmeasured (before n=${a?.n ?? 0}; after n=${b?.n ?? 0})`);
    }
  }
  if (reasons.length) return { verdict: "inconclusive", reasons };
  const increase = after.conflictRate - before.conflictRate;
  // Rates are floating-point fractions; equality with the band is not a regression.
  if (increase > noiseBand + Number.EPSILON) {
    reasons.push(`conflict rate rose by ${(increase * 100).toFixed(1)} percentage points (noise band ${(noiseBand * 100).toFixed(1)})`);
  }
  for (const finding of after.findingReproduction) {
    const prior = previous.get(finding.findingId);
    if (prior && prior.rate < 0.5 && finding.rate >= 0.5) reasons.push(`finding ${finding.findingId} reappeared`);
  }
  return { verdict: reasons.length ? "fail" : "pass", reasons };
}
