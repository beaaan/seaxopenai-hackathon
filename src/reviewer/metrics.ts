import type { Coding, Finding, Grade, Interval, Iteration, Reading } from "../shared/schema";

function conflictIndicators(readings: Reading[], grades: Grade[], threshold: number): number[] {
  const conflicting = new Set(grades.filter((grade) => grade.label === "conflicts" && grade.confidence >= threshold).map((grade) => grade.readingId));
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

export interface IterationMetricsArgs {
  version: number;
  readings: Reading[];
  grades: Grade[];
  codings: Coding[];
  findings: Finding[];
  scenarioIdsByFinding: Record<string, string[]>;
  noiseBand: number | null;
  noiseBandScenarios: number | null;
  threshold: number;
  seed: number;
}

export function iterationMetrics(args: IterationMetricsArgs): Omit<Iteration, "decision" | "reason"> {
  const readings = args.readings.filter((reading) => reading.policyVersion === args.version);
  const indicators = conflictIndicators(readings, args.grades, args.threshold);
  const scenarioByReading = new Map(readings.map((reading) => [reading.id, reading.scenarioId]));
  const presentScenarios = new Set(readings.map((reading) => reading.scenarioId));
  const probabilitiesByScenario = new Map<string, Map<string, number>>();
  for (const coding of args.codings) {
    const scenarioId = scenarioByReading.get(coding.readingId);
    if (scenarioId === undefined) continue;
    let probabilities = probabilitiesByScenario.get(scenarioId);
    if (!probabilities) {
      probabilities = new Map();
      probabilitiesByScenario.set(scenarioId, probabilities);
    }
    probabilities.set(coding.clusterId, Math.max(probabilities.get(coding.clusterId) ?? 0, coding.probability));
  }
  const findingReproduction = args.findings.map((finding) => {
    // A missing reading or wholly missing coding is unobserved, never a measured zero.
    const scenarioIds = [...new Set(args.scenarioIdsByFinding[finding.id] ?? [])].filter((id) => presentScenarios.has(id) && finding.evidence.clusterIds.some((clusterId) => probabilitiesByScenario.get(id)?.has(clusterId)));
    let sum = 0;
    for (const scenarioId of scenarioIds) {
      const probabilities = probabilitiesByScenario.get(scenarioId);
      let maximum = 0;
      for (const clusterId of finding.evidence.clusterIds) maximum = Math.max(maximum, probabilities?.get(clusterId) ?? 0);
      sum += maximum;
    }
    return { findingId: finding.id, rate: scenarioIds.length === 0 ? 0 : sum / scenarioIds.length, n: scenarioIds.length };
  });
  const wordingIds = new Set(args.findings.filter((finding) => finding.class === "wording_fix").map((finding) => finding.id));
  return {
    policyVersion: args.version,
    readings: readings.length,
    conflictRate: readings.length === 0 ? 0 : indicators.reduce((sum, value) => sum + value, 0) / readings.length,
    ci95: bootstrapCI(indicators, 2000, args.seed),
    openQuestionRate: readings.length === 0 ? 0 : readings.filter((reading) => reading.questions.length > 0).length / readings.length,
    openWordingFindings: findingReproduction.filter((finding) => wordingIds.has(finding.findingId) && finding.n > 0 && finding.rate >= 0.5).length,
    findingReproduction,
    noiseBand: args.noiseBand,
    noiseBandScenarios: args.noiseBandScenarios,
  };
}

export interface NoiseBand {
  band: number;
  pairedScenarios: number;
}

/** Test–retest noise (paired): mean drift or the 95% standard error, whichever is larger. */
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
  const pairedScenarios = differences.length;
  if (pairedScenarios === 0) return { band: 0, pairedScenarios };
  const mean = differences.reduce((sum, value) => sum + value, 0) / pairedScenarios;
  if (pairedScenarios < 2) return { band: Math.abs(mean), pairedScenarios };
  const variance = differences.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (pairedScenarios - 1);
  return { band: Math.max(Math.abs(mean), 1.96 * Math.sqrt(variance / pairedScenarios)), pairedScenarios };
}
