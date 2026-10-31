import { describe, expect, it } from "vitest";
import { compareSuite } from "../src/pipeline/suite";
import type { Iteration } from "../src/shared/schema";

function iteration(conflictRate: number, findingReproduction: Array<{ findingId: string; rate: number; n?: number }> = [], overrides: Partial<Iteration> = {}): Iteration {
  return {
    policyVersion: 0, readings: 10, conflictRate, ci95: { lo: 0, hi: 1 }, openQuestionRate: 0,
    openWordingFindings: 0, findingReproduction: findingReproduction.map((finding) => ({ ...finding, n: finding.n ?? 10 })),
    noiseBand: 0.1, noiseBandScenarios: 10, decision: "stop", reason: "test", ...overrides,
  };
}

describe("compareSuite", () => {
  it("fails when conflict increases beyond the noise band", () => {
    expect(compareSuite({ before: iteration(0.2), after: iteration(0.4), noiseBand: 0.1 })).toEqual({ verdict: "fail", reasons: [expect.stringContaining("conflict rate rose")] });
  });

  it("accepts improvement, unchanged rates, and increases at or below the band", () => {
    for (const rate of [0.1, 0.3, 0.35, 0.4]) {
      expect(compareSuite({ before: iteration(0.3), after: iteration(rate), noiseBand: 0.1 })).toEqual({ verdict: "pass", reasons: [] });
    }
    expect(compareSuite({ before: iteration(0.3), after: iteration(0.3), noiseBand: 0 }).verdict).toBe("pass");
  });

  it("fails at the reproduction boundary even if conflict improved", () => {
    const result = compareSuite({
      before: iteration(0.4, [{ findingId: "f1", rate: 0.49 }, { findingId: "f2", rate: 0.2 }]),
      after: iteration(0.1, [{ findingId: "f2", rate: 0.8 }, { findingId: "f1", rate: 0.5 }]), noiseBand: 0.1,
    });
    expect(result).toEqual({ reasons: ["finding f2 reappeared", "finding f1 reappeared"], verdict: "fail" });
  });

  it("does not call an unresolved measured finding a reappearance", () => {
    expect(compareSuite({
      before: iteration(0.2, [{ findingId: "f1", rate: 0.5 }]),
      after: iteration(0.2, [{ findingId: "f1", rate: 0.9 }]), noiseBand: 0,
    })).toEqual({ reasons: [], verdict: "pass" });
  });

  it.each([null, 0, 1, 4])("is inconclusive with %s noise pairs on either side", (count) => {
    for (const side of ["before", "after"] as const) {
      const args = { before: iteration(0.1), after: iteration(0.1), noiseBand: 0 };
      args[side] = iteration(0.1, [], { noiseBandScenarios: count });
      expect(compareSuite(args)).toEqual({ verdict: "inconclusive", reasons: [expect.stringContaining("inconclusive noise band")] });
    }
  });

  it("accepts exactly five measured pairs", () => {
    expect(compareSuite({ before: iteration(0, [], { readings: 5, noiseBandScenarios: 5 }), after: iteration(0, [], { readings: 5, noiseBandScenarios: 5 }), noiseBand: 0 }).verdict).toBe("pass");
  });

  it.each(["before", "after"] as const)("reports unmeasured, never reappeared/resolved, with n=0 %s", (side) => {
    const args = { before: iteration(0, [{ findingId: "f1", rate: 0.1 }]), after: iteration(0, [{ findingId: "f1", rate: 0.9 }]), noiseBand: 0 };
    args[side].findingReproduction[0]!.n = 0;
    const result = compareSuite(args);
    expect(result.verdict).toBe("inconclusive");
    expect(result.reasons).toEqual([expect.stringContaining("finding f1 unmeasured")]);
    expect(result.reasons.join(" ")).not.toMatch(/reappeared|resolved/);
  });

  it("treats missing required findings and absent scenario coverage as inconclusive", () => {
    expect(compareSuite({ before: iteration(0, [{ findingId: "f1", rate: 0 }]), after: iteration(0), noiseBand: 0 }).verdict).toBe("inconclusive");
    expect(compareSuite({ before: iteration(0, [], { readings: 0 }), after: iteration(0, [], { readings: 0 }), noiseBand: 0 }).verdict).toBe("inconclusive");
    expect(compareSuite({ before: iteration(0), after: iteration(0, [], { readings: 9 }), noiseBand: 0 }).verdict).toBe("inconclusive");
  });

  it("reports both regressions without changing its inputs", () => {
    const before = iteration(0, [{ findingId: "f1", rate: 0 }]);
    const after = iteration(1, [{ findingId: "f1", rate: 1 }]);
    const original = structuredClone({ before, after });
    const result = compareSuite({ before, after, noiseBand: 0 });
    expect(result.verdict).toBe("fail");
    expect(result.reasons).toHaveLength(2);
    expect({ before, after }).toEqual(original);
  });
});
