import { describe, expect, it } from "vitest";
import { discoveryCurve, homogeneity, splitTable } from "../src/sampler/stats";
import type { Cluster, Coding, Dimension, Grade, Reading, Scenario } from "../src/shared/schema";

function dimension(id: string): Dimension {
  return { id, name: id, description: id, origin: "extracted", rationale: "test", levels: [0, 1].map((level) => ({ id: `${id}${level}`, label: String(level), description: String(level) })) };
}

function reading(index: number): Reading {
  return { id: `r${index}`, scenarioId: `s${index}`, policyId: "test", policyVersion: 0, model: "test", paraphraseVi: "", interpretations: [], questions: [], actions: [], feelingVi: "" };
}

function scenario(index: number, levels: Scenario["levels"]): Scenario {
  return {
    id: `s${index}`, policyId: "test", batch: 0, origin: "seed", levels,
    persona: { name: "An", age: 30, province: "Hà Nội", occupation: "test", literacy: "medium", paymentInstruments: [], accountSharing: "none", history: "none" },
    exposure: { surfaceIds: [], folkVersionId: null, attention: "skim" }, situationVi: "test", allocationReason: null,
  };
}

function cluster(id: string, readingIds: string[], interpretationCount = readingIds.length): Cluster {
  return { id, policyVersion: 0, sentenceId: null, readingIds, interpretationIds: Array.from({ length: interpretationCount }, (_, index) => `${id}.i${index}`), labelEn: id, labelVi: id, conflictShare: 0 };
}

function planted(): { dimensions: Dimension[]; scenarios: Scenario[]; readings: Reading[]; codings: Coding[]; grades: Grade[]; threshold: number; permutations: number; seed: number } {
  let state = 139;
  const readings = Array.from({ length: 120 }, (_, index) => reading(index));
  const scenarios = readings.map((_, index) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return scenario(index, [{ dimId: "A", levelId: `A${index % 2}` }, { dimId: "B", levelId: `B${state >>> 31}` }]);
  });
  const codings = readings.map((item, index) => ({ readingId: item.id, clusterId: "belief", probability: index % 2 === 0 ? 0.05 : 0.95 }));
  return { dimensions: [dimension("A"), dimension("B")], scenarios, readings, codings, grades: [], threshold: 0.8, permutations: 200, seed: 17 };
}

describe("splitTable", () => {
  it("finds a planted soft belief split rather than an unrelated random dimension", () => {
    const [a, b] = splitTable(planted());
    expect(a?.nmi).toBeGreaterThan(0.7);
    expect(a?.z).toBeGreaterThan(10);
    expect(a?.z ?? 0).toBeGreaterThan((b?.z ?? 0) + 10);
    expect(b?.nmi).toBeLessThan(0.1);
  });

  it("repeats permutation results exactly for a seed and changes the null for another seed", () => {
    const args = planted();
    const first = splitTable(args);
    expect(splitTable(args)).toEqual(first);
    expect(splitTable({ ...args, seed: 91 })).not.toEqual(first);
  });

  it("uses expected soft counts, entropy weighting, and ignores constant beliefs", () => {
    const readings = [reading(0), reading(1)];
    const scenarios = [scenario(0, [{ dimId: "A", levelId: "A0" }]), scenario(1, [{ dimId: "A", levelId: "A1" }])];
    const codings = readings.flatMap((item, index) => [
      { readingId: item.id, clusterId: "split", probability: index === 0 ? 0.25 : 0.75 },
      { readingId: item.id, clusterId: "diffuse", probability: 0.5 },
      { readingId: item.id, clusterId: "constant", probability: 1 },
    ]);
    const result = splitTable({ dimensions: [dimension("A")], scenarios, readings, codings, grades: [], threshold: 0.8, permutations: 0, seed: 1 });
    const binaryEntropy = -0.25 * Math.log2(0.25) - 0.75 * Math.log2(0.75);
    expect(result[0]?.nmi).toBeCloseTo((1 - binaryEntropy) / 2, 12);
    expect(result[0]?.z).toBe(0);
  });

  it("codes actions by their enum, not wording, and counts a reader's duplicate action only once", () => {
    const readings = Array.from({ length: 4 }, (_, index) => reading(index));
    readings[0]!.actions = [{ action: "contact_support", detailVi: "hỏi" }, { action: "contact_support", detailVi: "hỏi lại" }];
    readings[2]!.actions = [{ action: "contact_support", detailVi: "khác" }];
    const scenarios = readings.map((_, index) => scenario(index, [{ dimId: "A", levelId: `A${index % 2}` }]));
    const result = splitTable({ dimensions: [dimension("A")], scenarios, readings, codings: [], grades: [], threshold: 0.8, permutations: 20, seed: 1 });
    expect(result[0]?.nmi).toBeCloseTo(1, 12);
  });

  it("counts only eligible readings and threshold-qualified conflicts once per reading", () => {
    const readings = [reading(0), reading(1), reading(2), reading(3)];
    const scenarios = [scenario(0, [{ dimId: "A", levelId: "A0" }]), scenario(1, [{ dimId: "A", levelId: "A0" }]), scenario(2, [])];
    const grades: Grade[] = [0, 1].map((index) => ({ readingId: "r0", interpretationId: `r0.i${index}`, label: "conflicts", confidence: 0.8, pConflicts: null, factIds: [], why: null }));
    grades.push(
      { readingId: "r1", interpretationId: "r1.i0", label: "conflicts", confidence: 0.79, pConflicts: null, factIds: [], why: null },
      { readingId: "r1", interpretationId: "r1.i1", label: "consistent", confidence: 1, pConflicts: null, factIds: [], why: null },
    );
    const [result] = splitTable({ dimensions: [dimension("A")], scenarios, readings, grades, codings: [], threshold: 0.8, permutations: 20, seed: 1 });
    expect(result?.byLevel).toEqual([{ levelId: "A0", n: 2, conflictShare: 0.5 }, { levelId: "A1", n: 0, conflictShare: 0 }]);
    expect(result?.nmi).toBe(0);
    expect(result?.z).toBe(0);
  });
});

describe("discoveryCurve", () => {
  it("reconciles renamed clusters using old-reader overlap, including the exact 50% boundary", () => {
    const points = discoveryCurve([
      { batch: 1, readingsSoFar: 14, clusters: [
        cluster("renamed", ["a", "b", "new1"]),
        cluster("mixed", ["a", "c", "e", "new2"]),
        cluster("half", ["b", "d", "new3"]),
        cluster("entirely-new", ["h", "i"]),
        cluster("one-reader", ["j"], 8),
        cluster("duplicate-reader", ["k", "k"], 8),
      ] },
      { batch: 0, readingsSoFar: 7, clusters: [cluster("old1", ["a", "b"]), cluster("old2", ["c", "d"]), cluster("old3", ["e", "f"]), cluster("singleton", ["g"])] },
    ]);
    expect(points).toEqual([{ batch: 0, readings: 7, newClusters: 3 }, { batch: 1, readings: 14, newClusters: 2 }]);
  });

  it("compares with the immediately previous batch, not historical ids or interpretation counts", () => {
    expect(discoveryCurve([
      { batch: 0, readingsSoFar: 2, clusters: [cluster("same-id", ["a", "b"])] },
      { batch: 1, readingsSoFar: 4, clusters: [cluster("same-id", ["c", "d"])] },
      { batch: 2, readingsSoFar: 4, clusters: [cluster("renamed-again", ["c", "d"])] },
    ]).map((point) => point.newClusters)).toEqual([1, 1, 0]);
    expect(discoveryCurve([])).toEqual([]);
  });

  it("matches overlap only within the same sentence, with null matching null", () => {
    const readers = ["a", "b"];
    const points = discoveryCurve([
      { batch: 0, readingsSoFar: 2, clusters: [cluster("original", readers)] },
      { batch: 1, readingsSoFar: 2, clusters: [cluster("renamed-null", readers)] },
      { batch: 2, readingsSoFar: 2, clusters: [{ ...cluster("different-sentence", readers), sentenceId: "main.1" }] },
      { batch: 3, readingsSoFar: 2, clusters: [{ ...cluster("same-sentence", readers), sentenceId: "main.1" }] },
      { batch: 4, readingsSoFar: 2, clusters: [{ ...cluster("another-sentence", readers), sentenceId: "main.2" }] },
    ]);
    expect(points.map((point) => point.newClusters)).toEqual([1, 0, 1, 0, 1]);
  });

  it("discovers a singleton lineage on its first growth to two distinct readers", () => {
    const points = discoveryCurve([
      { batch: 0, readingsSoFar: 1, clusters: [cluster("singleton", ["a", "a"], 5)] },
      { batch: 1, readingsSoFar: 2, clusters: [cluster("grown", ["a", "b"])] },
      { batch: 2, readingsSoFar: 2, clusters: [cluster("renamed", ["a", "b"])] },
      { batch: 3, readingsSoFar: 2, clusters: [cluster("shrunk", ["a"])] },
      { batch: 4, readingsSoFar: 3, clusters: [cluster("regrown", ["a", "c"])] },
    ]);
    expect(points.map((point) => point.newClusters)).toEqual([0, 1, 0, 0, 0]);
  });
});

describe("homogeneity", () => {
  it("averages character-trigram Jaccard across all paraphrase pairs", () => {
    const readings = [reading(0), reading(1), reading(2)];
    readings[0]!.paraphraseVi = "abcd";
    readings[1]!.paraphraseVi = "abce";
    readings[2]!.paraphraseVi = "wxyz";
    expect(homogeneity(readings)).toBeCloseTo(1 / 9, 12);
  });

  it("handles absent pairs and identical Vietnamese text", () => {
    expect(homogeneity([])).toBe(0);
    expect(homogeneity([reading(0)])).toBe(0);
    expect(homogeneity([{ ...reading(0), paraphraseVi: "Ví điện tử" }, { ...reading(1), paraphraseVi: "Ví điện tử" }])).toBe(1);
  });
});
