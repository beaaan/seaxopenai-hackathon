import { MIN_PAIRED_SCENARIOS } from "../reviewer/metrics";
import type { Iteration, SuiteComparison } from "../shared/schema";

export type SuiteResult = Pick<SuiteComparison, "verdict" | "reasons">;

const pct = (rate: number): string => `${(rate * 100).toFixed(0)}%`;
const pp = (delta: number): string => `${(delta * 100).toFixed(1)} pp`;

/**
 * Policy CI on identical scenario cohorts. Every change is judged against its own test–retest noise:
 * - fail: the conflict rate (when a reference exists) or any finding's reproduction rose beyond its band;
 * - inconclusive: < 5 paired scenarios, a finding measured before but not after, or — without a reference,
 *   where conflicts cannot be measured — no finding moved beyond its band;
 * - pass otherwise. `reasons` carries the evidence either way.
 */
export function compareSuite(args: { before: Iteration; after: Iteration; noiseBand: number; conflictMeasured: boolean }): SuiteResult {
  const { before, after, noiseBand, conflictMeasured } = args;
  const blockers: string[] = [];
  if (before.noiseBandScenarios === null || after.noiseBandScenarios === null || before.noiseBandScenarios < MIN_PAIRED_SCENARIOS || after.noiseBandScenarios < MIN_PAIRED_SCENARIOS) {
    blockers.push(`only ${before.noiseBandScenarios ?? 0}/${after.noiseBandScenarios ?? 0} test–retest pairs (minimum ${MIN_PAIRED_SCENARIOS})`);
  }
  if (before.readings < MIN_PAIRED_SCENARIOS || before.readings !== after.readings) {
    blockers.push(`scenario coverage ${before.readings} before vs ${after.readings} after (identical cohorts of at least ${MIN_PAIRED_SCENARIOS} required)`);
  }
  const regressions: string[] = [];
  const improvements: string[] = [];
  const notes: string[] = [];
  const current = new Map(after.findingReproduction.map((finding) => [finding.findingId, finding]));
  for (const prior of before.findingReproduction) {
    const next = current.get(prior.findingId);
    if (prior.n === 0) {
      notes.push(`${prior.findingId} not covered by these scenarios`);
      continue;
    }
    if (!next || next.n === 0) {
      blockers.push(`${prior.findingId} measured before (n=${prior.n}) but not after`);
      continue;
    }
    const change = `${prior.findingId} ${pct(prior.rate)} → ${pct(next.rate)}`;
    if (prior.noiseBand === null) {
      notes.push(`${change} (no noise estimate: < ${MIN_PAIRED_SCENARIOS} re-read pairs)`);
      continue;
    }
    const delta = next.rate - prior.rate;
    // Rates are floating-point means; a change equal to the band is within noise.
    if (delta > prior.noiseBand + Number.EPSILON) regressions.push(`${change} rose beyond noise ±${pp(prior.noiseBand)}`);
    else if (-delta > prior.noiseBand + Number.EPSILON) improvements.push(`${change} fell beyond noise ±${pp(prior.noiseBand)}`);
    else notes.push(`${change} within noise ±${pp(prior.noiseBand)}`);
  }
  if (blockers.length) return { verdict: "inconclusive", reasons: [...blockers, ...regressions, ...improvements, ...notes] };
  if (conflictMeasured) {
    const increase = after.conflictRate - before.conflictRate;
    const conflict = `conflict rate ${pct(before.conflictRate)} → ${pct(after.conflictRate)} (noise ±${pp(noiseBand)})`;
    if (increase > noiseBand + Number.EPSILON) regressions.unshift(`${conflict} rose beyond noise`);
    else notes.unshift(conflict);
  } else {
    notes.unshift("no reference: conflict rate not measured");
  }
  if (regressions.length) return { verdict: "fail", reasons: [...regressions, ...improvements, ...notes] };
  if (!conflictMeasured && improvements.length === 0) return { verdict: "inconclusive", reasons: ["no finding moved beyond its noise band", ...notes] };
  return { verdict: "pass", reasons: [...improvements, ...notes] };
}
