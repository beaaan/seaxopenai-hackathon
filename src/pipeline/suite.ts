import type { Iteration, SuiteComparison } from "../shared/schema";

export type SuiteResult = Pick<SuiteComparison, "regressions" | "passed">;

/** Compare the same scenarios with the suite's frozen measurement instrument. */
export function compareSuite(args: { before: Iteration; after: Iteration; noiseBand: number }): SuiteResult {
  const { before, after, noiseBand } = args;
  const regressions: string[] = [];
  const increase = after.conflictRate - before.conflictRate;
  // Rates are floating-point fractions; equality with the band is not a regression.
  if (increase > noiseBand + Number.EPSILON) {
    regressions.push(`conflict rate rose by ${(increase * 100).toFixed(1)} percentage points (noise band ${(noiseBand * 100).toFixed(1)})`);
  }
  const previous = new Map(before.findingReproduction.map((finding) => [finding.findingId, finding.rate]));
  for (const finding of after.findingReproduction) {
    const rate = previous.get(finding.findingId);
    if (rate !== undefined && rate < 0.5 && finding.rate >= 0.5) {
      regressions.push(`finding ${finding.findingId} reappeared`);
    }
  }
  return { regressions, passed: regressions.length === 0 };
}
