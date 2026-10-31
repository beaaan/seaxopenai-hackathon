import { describe, expect, it } from "vitest";
import { measureComparison, type ComparisonInput } from "../src/pipeline/comparison";
import { compareSuite } from "../src/pipeline/suite";
import { stopDecision } from "../src/reviewer/stop";
import type { Coding, FidelityResult, Finding, Grade, Reading } from "../src/shared/schema";

const faithful: FidelityResult = { passed: true, facts: [], newCommitments: [], requiresNewFact: null };

function reading(index: number, version: number, tag = ""): Reading {
  return { id: `r-s${index}-v${version}${tag}`, scenarioId: `s${index}`, policyId: "test", policyVersion: version, model: "test",
    paraphraseVi: "", interpretations: [], questions: [], actions: [], feelingVi: "" };
}

function fixture(beforeRate = 0.9, afterRate = 0.1): ComparisonInput {
  const before = Array.from({ length: 10 }, (_, i) => reading(i, 0));
  const repeat = before.map((_, i) => reading(i, 0, "-rt"));
  const after = before.map((_, i) => reading(i, 1));
  const finding: Finding = { id: "f1", title: "f1", sentenceIds: [], readingSummary: "", plausibility: "", dimsAssociated: [],
    conflictsReference: false, factIds: [], class: "wording_fix", classRationale: "", repair: null,
    evidence: { clusterIds: ["c1", "c2"], scenarioIds: ["s0"], readingIds: [before[0]!.id] } };
  const code = (readings: Reading[], rate: number): Coding[] => readings.flatMap((r) => [
    { readingId: r.id, clusterId: "c1", probability: 0 }, { readingId: r.id, clusterId: "c2", probability: rate },
  ]);
  return { scenarioIds: before.map((r) => r.scenarioId), beforeVersion: 0, afterVersion: 1, beforeReadings: before,
    afterReadings: after, originalReadings: before, repeatReadings: repeat, grades: [],
    codings: [...code(before, beforeRate), ...code(repeat, beforeRate), ...code(after, afterRate)],
    findings: [finding], conflictMeasured: false, threshold: 0.5, seed: 1 };
}

function compare(input: ComparisonInput) {
  return compareSuite({ ...measureComparison(input), conflictMeasured: input.conflictMeasured, fidelity: faithful });
}

function gradesFor(readings: Reading[], probability: (index: number) => number | null): Grade[] {
  return readings.map((reading, index) => {
    const id = `${reading.id}.i1`;
    reading.interpretations = [{ id, sentenceId: null, quote: "", meaningVi: "", glossEn: "", confidence: 1 }];
    const pConflicts = probability(index);
    return { readingId: reading.id, interpretationId: id, label: pConflicts === null ? "unclear" : pConflicts > 0.5 ? "conflicts" : "consistent",
      confidence: pConflicts === null ? 0 : 1, pConflicts, factIds: [], why: null };
  });
}

describe("complete paired measurement gate shared by CI and rewrites", () => {
  it("passes a faithful finding improvement without reference facts", () => {
    expect(compare(fixture()).verdict).toBe("pass");
  });

  it("does not pass when ten coded readers become one", () => {
    const input = fixture();
    input.codings = input.codings.filter((c) => !c.readingId.endsWith("v1") || c.readingId === "r-s0-v1");
    const result = compare(input);
    expect(result.verdict).toBe("inconclusive");
    expect(result.reasons.join(" ")).toContain("10/10 before vs 1/10 after");
  });

  it("does not turn a refused cluster into a low belief score", () => {
    const input = fixture();
    input.codings = input.codings.filter((c) => !(c.readingId.endsWith("v1") && c.clusterId === "c2"));
    expect(measureComparison(input).after.findingReproduction[0]?.n).toBe(0);
    expect(compare(input).verdict).toBe("inconclusive");
  });

  it("rejects equal-size cohorts with different scenario identities", () => {
    const input = fixture();
    input.afterReadings[0] = { ...input.afterReadings[0]!, scenarioId: "other" };
    expect(compare(input).verdict).toBe("inconclusive");
    expect(compare(input).reasons.join(" ")).toContain("identical selected scenarios");
  });

  it("rejects duplicate scenarios and missing readers, even when both sides have the same loss", () => {
    const input = fixture();
    input.afterReadings[0] = { ...input.afterReadings[0]!, scenarioId: "s1" };
    expect(compare(input).verdict).toBe("inconclusive");
    const missing = fixture();
    missing.beforeReadings = missing.beforeReadings.slice(1);
    missing.afterReadings = missing.afterReadings.slice(1);
    expect(compare(missing).verdict).toBe("inconclusive");
  });

  it("does not pass without enough complete test-retest codings for each finding", () => {
    const input = fixture();
    const keep = new Set(input.repeatReadings.slice(0, 4).map((r) => r.id));
    input.codings = input.codings.filter((c) => !c.readingId.endsWith("-rt") || keep.has(c.readingId));
    expect(compare(input).verdict).toBe("inconclusive");
    expect(compare(input).reasons.join(" ")).toContain("no noise estimate");
  });

  it("does not count a refused grade as a non-conflicting reading", () => {
    const input = fixture();
    input.conflictMeasured = true;
    const r = input.afterReadings[0]!;
    r.interpretations = [{ id: `${r.id}.i1`, sentenceId: null, quote: "", meaningVi: "", glossEn: "", confidence: 1 }];
    input.grades = [{ readingId: r.id, interpretationId: `${r.id}.i1`, label: "unclear", confidence: 0, pConflicts: null, factIds: [], why: null }];
    expect(compare(input).verdict).toBe("inconclusive");
    expect(compare(input).reasons.join(" ")).toContain("grades are missing or refused");
  });

  it("keeps valid finding-noise pairs independently of conflict-grade coverage", () => {
    const input = fixture();
    input.conflictMeasured = true;
    input.grades = [...gradesFor(input.beforeReadings, () => 0), ...gradesFor(input.afterReadings, () => 0),
      ...gradesFor(input.repeatReadings, (i) => i < 5 ? 0 : null)];
    input.codings = input.codings.filter((coding) => coding.readingId !== input.repeatReadings[0]!.id);
    const measured = measureComparison(input);
    expect(measured.after.noiseBandScenarios).toBe(5);
    expect(measured.after.findingReproduction[0]?.noiseBand).toBe(0);
    expect(compare(input).verdict).toBe("pass");
  });

  it("uses the validated conflict-noise band consistently for acceptance and stopping", () => {
    const input = fixture(0.9, 0.6);
    input.conflictMeasured = true;
    input.grades = [...gradesFor(input.beforeReadings, () => 0), ...gradesFor(input.afterReadings, (i) => i < 6 ? 1 : 0),
      ...gradesFor(input.repeatReadings, (i) => i < 5 ? 1 : null)];
    const measured = measureComparison(input);
    expect(measured.after.noiseBandScenarios).toBe(5);
    expect(measured.after.noiseBand).toBe(1);
    expect(compare(input).verdict).toBe("pass");
    const decision = stopDecision({ history: [{ ...measured.before, decision: "continue", reason: "initial" }],
      current: measured.after, iterationIndex: 1, maxIterations: 3, fidelityFailures: 0, conflictMeasured: true });
    expect(decision.reason).toContain("within the noise band 1.00");
    expect(decision.reason).not.toContain("keeping the previous version");
  });

  it("rejects finding regressions with unmeasured or unchanged conflict rates", () => {
    for (const conflictMeasured of [false, true]) {
      const input = fixture(0.2, 0.8);
      input.conflictMeasured = conflictMeasured;
      expect(compare(input).verdict).toBe("fail");
    }
  });

  it("catches a belief spreading beyond the finding's original holders", () => {
    const input = fixture(0, 0.9);
    // Original holder improves, but nine other readers acquire the belief.
    for (const coding of input.codings) if (coding.clusterId === "c2" && coding.readingId.startsWith("r-s0-")) {
      coding.probability = coding.readingId.endsWith("v1") ? 0 : 1;
    }
    expect(compare(input).verdict).toBe("fail");
  });

  it("rejects a no-reference regression even when a different finding improves", () => {
    const input = fixture();
    input.findings.push({ ...input.findings[0]!, id: "f2", evidence: { clusterIds: ["c3"], scenarioIds: [], readingIds: [] } });
    for (const reading of [...input.beforeReadings, ...input.repeatReadings, ...input.afterReadings]) {
      input.codings.push({ readingId: reading.id, clusterId: "c3", probability: reading.policyVersion === 1 ? 0.8 : 0.1 });
    }
    const result = compare(input);
    expect(result.verdict).toBe("fail");
    expect(result.reasons.join(" ")).toContain("f2 10% → 80% rose beyond noise");
  });

  it("requires a no-reference improvement beyond the five-point floor", () => {
    expect(compare(fixture(0.5, 0.45)).verdict).toBe("inconclusive");
    expect(compare(fixture(0.5, 0.44)).verdict).toBe("pass");
  });

  it("continues a successful no-reference rewrite while wording work remains", () => {
    const input = fixture(0.9, 0.6);
    const measured = measureComparison(input);
    expect(compare(input).verdict).toBe("pass");
    const decision = stopDecision({ history: [{ ...measured.before, decision: "continue", reason: "initial" }],
      current: measured.after, iterationIndex: 1, maxIterations: 3, fidelityFailures: 0, conflictMeasured: false });
    expect(decision.decision).toBe("continue");
    expect(decision.reason).not.toContain("within the noise band");
  });
});
