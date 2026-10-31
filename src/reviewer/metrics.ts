import type { Coding, Finding, Grade, Interval, Iteration, Reading } from "../shared/schema";
import { isConflict } from "./grade";

function conflictIndicators(readings: Reading[], grades: Grade[], threshold: number): number[] {
  const conflicting = new Set(grades.filter((grade) => isConflict(grade, threshold)).map((grade) => grade.readingId));
  return readings.map((reading) => (conflicting.has(reading.id) ? 1 : 0));
}

/** A reading counts once, regardless of how many of its interpretations conflict. */
export function conflictRate(readings: Reading[], grades: Grade[], threshold: number): number {
  if (readings.length === 0) return 0;
  return conflictIndicators(readings, grades, threshold).reduce((sum, value) => sum + value, 0) / readings.length;
}

/** Percentile bootstrap of the mean, with the same seeded PRNG used by fixture generation. */
export function bootstrapCI(values: number[], iterations: number, seed: number): Interval {
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error("bootstrap iterations must be a positive integer");
  if (values.length === 0) return { lo: 0, hi: 0 };
  let state = seed >>> 0;
  const means: number[] = [];
  for (let iteration = 0; iteration < iterations; iteration++) {
    let sum = 0;
    for (let sample = 0; sample < values.length; sample++) {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const random = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      sum += values[Math.floor(random * values.length)]!;
    }
    means.push(sum / values.length);
  }
  means.sort((a, b) => a - b);
  const percentile = (p: number): number => {
    const position = p * (means.length - 1);
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    return means[lower]! + (means[upper]! - means[lower]!) * (position - lower);
  };
  return { lo: percentile(0.025), hi: percentile(0.975) };
}

/** Comparisons on fewer paired scenarios than this are inconclusive. */
export const MIN_PAIRED_SCENARIOS = 5;

export interface IterationMetricsArgs {
  version: number;
  readings: Reading[];
  grades: Grade[];
  codings: Coding[];
  findings: Finding[];
  scenarioIdsByFinding: Record<string, string[]>;
  noiseBand: number | null;
  noiseBandScenarios: number | null;
  /** Per-finding test–retest noise (see reproductionNoise); null before it has been measured. */
  reproductionNoise: Record<string, NoiseBand> | null;
  threshold: number;
  seed: number;
}

/**
 * One finding's reproduction per scenario: max P(belief) over the finding's clusters. Scenarios without a reading,
 * or without any coding of those clusters, are absent (unobserved), never a measured zero.
 */
export function reproductionByScenario(finding: Finding, scenarioIds: readonly string[], readings: Reading[], codings: Coding[]): Map<string, number> {
  const scenarioByReading = new Map(readings.map((reading) => [reading.id, reading.scenarioId]));
  const wanted = new Set(scenarioIds);
  const clusters = new Set(finding.evidence.clusterIds);
  const out = new Map<string, number>();
  for (const coding of codings) {
    if (!clusters.has(coding.clusterId)) continue;
    const scenarioId = scenarioByReading.get(coding.readingId);
    if (scenarioId === undefined || !wanted.has(scenarioId)) continue;
    out.set(scenarioId, Math.max(out.get(scenarioId) ?? 0, coding.probability));
  }
  return out;
}

export function iterationMetrics(args: IterationMetricsArgs): Omit<Iteration, "decision" | "reason"> {
  const readings = args.readings.filter((reading) => reading.policyVersion === args.version);
  const indicators = conflictIndicators(readings, args.grades, args.threshold);
  const findingReproduction = args.findings.map((finding) => {
    const values = [...reproductionByScenario(finding, args.scenarioIdsByFinding[finding.id] ?? [], readings, args.codings).values()];
    const noise = args.reproductionNoise?.[finding.id];
    return {
      findingId: finding.id,
      rate: values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length,
      n: values.length,
      noiseBand: noise !== undefined && noise.pairedScenarios >= MIN_PAIRED_SCENARIOS ? noise.band : null,
    };
  });
  const wordingIds = new Set(args.findings.filter((finding) => finding.class === "wording_fix").map((finding) => finding.id));
  return {
    policyVersion: args.version,
    readings: readings.length,
    conflictRate: readings.length === 0 ? 0 : indicators.reduce((sum, value) => sum + value, 0) / readings.length,
    ci95: bootstrapCI(indicators, 2000, args.seed),
    openQuestionRate: readings.length === 0 ? 0 : readings.filter((reading) => reading.questions.length > 0).length / readings.length,
    openWordingFindings: findingReproduction.filter((finding) => wordingIds.has(finding.findingId) && (finding.n === 0 || finding.rate >= 0.5)).length,
    findingReproduction,
    noiseBand: args.noiseBand,
    noiseBandScenarios: args.noiseBandScenarios,
  };
}

export interface NoiseBand {
  band: number;
  pairedScenarios: number;
}

/** Mean drift or the 95% standard error of paired differences, whichever is larger. */
function pairedBand(differences: number[]): number {
  const n = differences.length;
  if (n === 0) return 0;
  const mean = differences.reduce((sum, value) => sum + value, 0) / n;
  if (n < 2) return Math.abs(mean);
  const variance = differences.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
  return Math.max(Math.abs(mean), 1.96 * Math.sqrt(variance / n));
}

/** Test–retest noise of the conflict rate (paired over scenarios read in both runs). */
export function noiseBand(a: { readings: Reading[]; grades: Grade[] }, b: { readings: Reading[]; grades: Grade[] }, threshold: number): NoiseBand {
  const scenariosA = new Map<string, number>();
  const scenariosB = new Map<string, number>();
  for (const [run, scenarios] of [[a, scenariosA], [b, scenariosB]] as const) {
    const indicators = conflictIndicators(run.readings, run.grades, threshold);
    run.readings.forEach((reading, index) => scenarios.set(reading.scenarioId, Math.max(scenarios.get(reading.scenarioId) ?? 0, indicators[index]!)));
  }
  const differences: number[] = [];
  for (const [scenarioId, conflictA] of scenariosA) {
    const conflictB = scenariosB.get(scenarioId);
    if (conflictB !== undefined) differences.push(conflictA - conflictB);
  }
  return { band: pairedBand(differences), pairedScenarios: differences.length };
}

/**
 * Test–retest noise of each finding's reproduction rate: the same paired rule as noiseBand, on the finding's
 * scenarios coded in both runs of the SAME text (v0 and its re-read).
 */
export function reproductionNoise(
  findings: Finding[],
  scenarioIdsByFinding: Record<string, string[]>,
  a: { readings: Reading[]; codings: Coding[] },
  b: { readings: Reading[]; codings: Coding[] },
): Record<string, NoiseBand> {
  return Object.fromEntries(findings.map((finding) => {
    const ids = scenarioIdsByFinding[finding.id] ?? [];
    const before = reproductionByScenario(finding, ids, a.readings, a.codings);
    const after = reproductionByScenario(finding, ids, b.readings, b.codings);
    const differences = [...before].flatMap(([scenarioId, p]) => {
      const q = after.get(scenarioId);
      return q === undefined ? [] : [p - q];
    });
    return [finding.id, { band: pairedBand(differences), pairedScenarios: differences.length }];
  }));
}
