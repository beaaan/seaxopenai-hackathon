import { iterationMetrics, noiseBand, reproductionNoise } from "../reviewer/metrics";
import type { Coding, Finding, Grade, Iteration, Reading } from "../shared/schema";

export type IterationMeasurement = Omit<Iteration, "decision" | "reason">;

export interface ComparisonMeasurements {
  before: IterationMeasurement;
  after: IterationMeasurement;
  noiseBand: number;
  coverageIssues: string[];
}

export interface ComparisonInput {
  scenarioIds: readonly string[];
  beforeVersion: number;
  afterVersion: number;
  beforeReadings: Reading[];
  afterReadings: Reading[];
  originalReadings: Reading[];
  repeatReadings: Reading[];
  grades: Grade[];
  codings: Coding[];
  findings: Finding[];
  conflictMeasured: boolean;
  threshold: number;
  seed: number;
}

/** Measure every finding on the entire intended cohort, and retain evidence of missing observations. */
export function measureComparison(args: ComparisonInput): ComparisonMeasurements {
  const expected = new Set(args.scenarioIds);
  const coverageIssues: string[] = [];
  const grades = new Map(args.grades.map((grade) => [grade.interpretationId, grade]));
  const graded = (reading: Reading): boolean => reading.interpretations.every((interpretation) => {
    const grade = grades.get(interpretation.id);
    return grade?.readingId === reading.id && (grade.pConflicts !== null || grade.confidence > 0);
  });
  for (const [label, readings, version] of [
    ["before", args.beforeReadings, args.beforeVersion], ["after", args.afterReadings, args.afterVersion],
  ] as const) {
    const ids = new Set(readings.map((reading) => reading.scenarioId));
    if (ids.size !== readings.length || ids.size !== expected.size || readings.some((reading) => !expected.has(reading.scenarioId) || reading.policyVersion !== version)) {
      coverageIssues.push(`${label} readings do not cover the identical selected scenarios exactly once`);
    }
    if (args.conflictMeasured && readings.some((reading) => !graded(reading))) {
      coverageIssues.push(`${label} conflict grades are missing or refused`);
    }
  }
  const original = args.originalReadings.filter((reading) => expected.has(reading.scenarioId));
  const repeat = args.repeatReadings.filter((reading) => expected.has(reading.scenarioId));
  // Grade and belief coverage are independent. A refused grade is not an observed non-conflict,
  // but it does not invalidate a complete coding of the same reading's beliefs.
  const conflictReadings = (readings: Reading[]): Reading[] => args.conflictMeasured ? readings.filter(graded) : readings;
  const noise = noiseBand({ readings: conflictReadings(original), grades: args.grades }, { readings: conflictReadings(repeat), grades: args.grades }, args.threshold);
  const findingScenarios = Object.fromEntries(args.findings.map((finding) => [finding.id, [...expected]]));
  const findingNoise = reproductionNoise(args.findings, findingScenarios,
    { readings: original, codings: args.codings }, { readings: repeat, codings: args.codings });
  const measure = (version: number, readings: Reading[]): IterationMeasurement => iterationMetrics({
    version, readings, grades: args.grades, codings: args.codings, findings: args.findings,
    scenarioIdsByFinding: findingScenarios, noiseBand: noise.band, noiseBandScenarios: noise.pairedScenarios,
    reproductionNoise: findingNoise, threshold: args.threshold, seed: args.seed,
  });
  return { before: measure(args.beforeVersion, args.beforeReadings), after: measure(args.afterVersion, args.afterReadings), noiseBand: noise.band, coverageIssues };
}
