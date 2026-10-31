import { describe, expect, it } from "vitest";
import { bootstrapCI, conflictRate, iterationMetrics, noiseBand, reproductionNoise } from "../src/reviewer/metrics";
import type { Finding, Grade, Reading } from "../src/shared/schema";

function reading(scenarioId: string, version = 0, questionCount = 0): Reading {
  const id = `r-${scenarioId}-v${version}`;
  return {
    id, scenarioId, policyId: "example", policyVersion: version, model: "test", paraphraseVi: "", interpretations: [],
    questions: Array.from({ length: questionCount }, (_, index) => ({ id: `${id}.q${index}`, quote: null, questionVi: "?", glossEn: "?" })),
    actions: [], feelingVi: "",
  };
}

function grade(value: Reading, confidence = 1, label: Grade["label"] = "conflicts"): Grade {
  return { readingId: value.id, interpretationId: `${value.id}.i1`, label, confidence, pConflicts: null, factIds: [], why: null };
}

function finding(id: string, clusterIds: string[], classification: Finding["class"] = "wording_fix"): Finding {
  return {
    id, title: id, sentenceIds: [], readingSummary: id, plausibility: "", dimsAssociated: [], conflictsReference: true, factIds: [],
    class: classification, classRationale: "", repair: null, evidence: { clusterIds, scenarioIds: [], readingIds: [] },
  };
}

describe("conflictRate", () => {
  it("counts each reading once at the inclusive confidence threshold", () => {
    const readings = [reading("s1"), reading("s2"), reading("s3"), reading("s4")];
    const grades = [grade(readings[0]!, 0.9), grade(readings[0]!, 0.8), grade(readings[1]!, 0.5), grade(readings[2]!, 0.49), grade(readings[3]!, 1, "outside"), grade(reading("not-present"))];
    expect(conflictRate(readings, grades, 0.5)).toBe(0.5);
    expect(conflictRate(readings, grades, 0.8)).toBe(0.25);
    expect(conflictRate(readings, [], 0.5)).toBe(0);
    expect(conflictRate([], grades, 0.5)).toBe(0);
  });

  it("uses calibrated conflict probability even when another label won", () => {
    const value = reading("s1");
    expect(conflictRate([value], [{ ...grade(value, 0.5, "consistent"), pConflicts: 0.5 }], 0.5)).toBe(1);
    expect(conflictRate([value], [{ ...grade(value, 0.6, "outside"), pConflicts: 0.4 }], 0.5)).toBe(0);
  });
});

describe("bootstrapCI", () => {
  it("is seeded, bounded and does not mutate observations", () => {
    const values = [0, 1, 0, 0, 1, 0, 1, 0, 0, 1];
    const original = [...values];
    const interval = bootstrapCI(values, 1000, 73);
    expect(bootstrapCI(values, 1000, 73)).toEqual(interval);
    expect(interval.lo).toBeGreaterThanOrEqual(0);
    expect(interval.hi).toBeLessThanOrEqual(1);
    expect(interval.lo).toBeLessThan(interval.hi);
    expect(interval.lo).toBeLessThanOrEqual(0.4);
    expect(interval.hi).toBeGreaterThanOrEqual(0.4);
    expect(values).toEqual(original);
  });

  it("handles empty, singleton and constant cohorts", () => {
    expect(bootstrapCI([], 100, 1)).toEqual({ lo: 0, hi: 0 });
    expect(bootstrapCI([1], 100, 1)).toEqual({ lo: 1, hi: 1 });
    expect(bootstrapCI([0, 0, 0], 100, 1)).toEqual({ lo: 0, hi: 0 });
    expect(bootstrapCI([1, 1, 1], 100, 1)).toEqual({ lo: 1, hi: 1 });
    expect(() => bootstrapCI([0, 1], 0, 1)).toThrow("positive integer");
  });
});

describe("iterationMetrics", () => {
  it("uses per-scenario maximum belief probabilities and reports observed denominators", () => {
    const r1 = reading("s1", 1, 2);
    const r2 = reading("s2", 1);
    const r3 = reading("s3", 1, 1);
    const uncoded = reading("uncoded", 1);
    const previous = reading("s1", 0);
    const result = iterationMetrics({
      version: 1, readings: [r1, r2, r3, uncoded, previous], grades: [grade(r1, 0.5), grade(r2, 0.4), grade(previous)],
      codings: [
        { readingId: r1.id, clusterId: "c1", probability: 0.8 }, { readingId: r1.id, clusterId: "c2", probability: 0.9 },
        { readingId: r2.id, clusterId: "c1", probability: 0.1 }, { readingId: r2.id, clusterId: "c2", probability: 0.6 },
        { readingId: r3.id, clusterId: "c1", probability: 0 },
        { readingId: r1.id, clusterId: "c3", probability: 1 }, { readingId: r1.id, clusterId: "c4", probability: 0.49 },
        { readingId: previous.id, clusterId: "c1", probability: 1 },
      ],
      findings: [finding("f1", ["c1", "c2"]), finding("f2", ["c3"], "design_gap"), finding("f3", ["c1"]), finding("f4", ["c4"])],
      scenarioIdsByFinding: { f1: ["s1", "s2", "s3", "uncoded", "missing"], f2: ["s1"], f3: ["missing", "uncoded"], f4: ["s1"] },
      threshold: 0.5, noiseBand: 0.1, noiseBandScenarios: 10, seed: 7,
      reproductionNoise: { f1: { band: 0.2, pairedScenarios: 5 }, f2: { band: 0.3, pairedScenarios: 4 } },
    });
    expect(result.readings).toBe(4);
    expect(result.conflictRate).toBe(1 / 4);
    expect(result.openQuestionRate).toBe(2 / 4);
    expect(result.findingReproduction).toEqual([
      { findingId: "f1", rate: 0.5, n: 3, noiseBand: 0.2 }, { findingId: "f2", rate: 1, n: 1, noiseBand: null },
      { findingId: "f3", rate: 0, n: 0, noiseBand: null }, { findingId: "f4", rate: 0.49, n: 1, noiseBand: null },
    ]);
    expect(result.openWordingFindings).toBe(2);
    expect(result.noiseBand).toBe(0.1);
    expect(result.noiseBandScenarios).toBe(10);
  });

  it("does not treat absent readings as observed non-conflicts", () => {
    const result = iterationMetrics({ version: 1, readings: [], grades: [], codings: [], findings: [finding("f1", ["c1"])], scenarioIdsByFinding: { f1: ["s1"] }, noiseBand: null, noiseBandScenarios: null, reproductionNoise: null, threshold: 0.5, seed: 1 });
    expect(result.readings).toBe(0);
    expect(result.ci95).toEqual({ lo: 0, hi: 0 });
    expect(result.findingReproduction).toEqual([{ findingId: "f1", rate: 0, n: 0, noiseBand: null }]);
    expect(result.openWordingFindings).toBe(1);
  });
});

describe("reproductionNoise", () => {
  it("pairs only scenarios coded in both runs and takes the larger of drift and paired SE", () => {
    const a = ["s1", "s2", "s3"].map((id) => reading(id, 0));
    const b = ["s1", "s2", "s4"].map((id) => ({ ...reading(id, 0), id: `r-${id}-v0-rt` }));
    const noise = reproductionNoise(
      [finding("f1", ["c1", "c2"])],
      { f1: ["s1", "s2", "s3", "s4"] },
      { readings: a, codings: [{ readingId: a[0]!.id, clusterId: "c1", probability: 0.9 }, { readingId: a[1]!.id, clusterId: "c2", probability: 0.5 }, { readingId: a[2]!.id, clusterId: "c1", probability: 1 }] },
      { readings: b, codings: [{ readingId: b[0]!.id, clusterId: "c2", probability: 0.7 }, { readingId: b[1]!.id, clusterId: "c1", probability: 0.5 }, { readingId: b[2]!.id, clusterId: "c1", probability: 0 }] },
    );
    // Paired: s1 (0.9 − 0.7) and s2 (0.5 − 0.5); s3 and s4 were coded in one run only.
    expect(noise.f1!.pairedScenarios).toBe(2);
    const mean = 0.1;
    const se = Math.sqrt(((0.2 - mean) ** 2 + (0 - mean) ** 2) / 1 / 2);
    expect(noise.f1!.band).toBeCloseTo(Math.max(mean, 1.96 * se), 12);
  });
});

describe("noiseBand", () => {
  it("uses only overlapping scenarios and paired uncertainty", () => {
    const shared = Array.from({ length: 5 }, (_, index) => reading(`s${index}`));
    const onlyA = reading("only-a");
    const onlyB = reading("only-b");
    const a = { readings: [...shared, onlyA], grades: [grade(shared[0]!), grade(onlyA)] };
    const b = { readings: [...shared, onlyB], grades: [] };
    const result = noiseBand(a, b, 0.5);
    expect(result.pairedScenarios).toBe(5);
    expect(result.band).toBeCloseTo(0.392);
    expect(result).toEqual(noiseBand({ readings: shared, grades: a.grades }, { readings: shared, grades: [] }, 0.5));
  });

  it("does not cancel offsetting per-scenario changes into a zero band", () => {
    const readings = Array.from({ length: 5 }, (_, index) => reading(`s${index}`));
    const result = noiseBand({ readings, grades: [grade(readings[0]!)] }, { readings, grades: [grade(readings[1]!)] }, 0.5);
    expect(result.band).toBeCloseTo(1.96 * Math.sqrt(0.5 / 5));
    expect(result.pairedScenarios).toBe(5);
  });

  it("reports no pairs and one pair explicitly", () => {
    const value = reading("s1");
    expect(noiseBand({ readings: [value], grades: [grade(value)] }, { readings: [], grades: [] }, 0.5)).toEqual({ band: 0, pairedScenarios: 0 });
    expect(noiseBand({ readings: [value], grades: [grade(value)] }, { readings: [value], grades: [] }, 0.5)).toEqual({ band: 1, pairedScenarios: 1 });
    expect(noiseBand({ readings: [value], grades: [grade(value, 0.49)] }, { readings: [value], grades: [] }, 0.5)).toEqual({ band: 0, pairedScenarios: 1 });
  });
});
