import { describe, expect, it } from "vitest";
import { compareSuite } from "../src/pipeline/suite";
import type { Iteration } from "../src/shared/schema";

function iteration(conflictRate: number, findingReproduction: Array<{ findingId: string; rate: number }> = []): Iteration {
  return {
    policyVersion: 0, readings: 10, conflictRate, ci95: { lo: 0, hi: 1 }, openQuestionRate: 0,
    openWordingFindings: 0, findingReproduction: findingReproduction.map((finding) => ({ ...finding, n: 10 })), noiseBand: 0.1, noiseBandScenarios: 10, decision: "stop", reason: "test",
  };
}

describe("compareSuite", () => {
  it("fails when conflict increases beyond the noise band", () => {
    const result = compareSuite({ before: iteration(0.2), after: iteration(0.4), noiseBand: 0.1 });
    expect(result.passed).toBe(false);
    expect(result.regressions).toEqual([expect.stringContaining("conflict rate rose")]);
  });

  it("accepts improvement, unchanged rates, and increases at or below the band", () => {
    for (const rate of [0.1, 0.3, 0.35, 0.4]) {
      expect(compareSuite({ before: iteration(0.3), after: iteration(rate), noiseBand: 0.1 })).toEqual({ regressions: [], passed: true });
    }
    expect(compareSuite({ before: iteration(0.3), after: iteration(0.3), noiseBand: 0 }).passed).toBe(true);
  });

  it("fails at the reproduction boundary even if conflict improved", () => {
    const result = compareSuite({
      before: iteration(0.4, [{ findingId: "f1", rate: 0.49 }, { findingId: "f2", rate: 0.2 }]),
      after: iteration(0.1, [{ findingId: "f2", rate: 0.8 }, { findingId: "f1", rate: 0.5 }]), noiseBand: 0.1,
    });
    expect(result).toEqual({ regressions: ["finding f2 reappeared", "finding f1 reappeared"], passed: false });
  });

  it("does not call an unresolved or previously unmeasured finding a reappearance", () => {
    expect(compareSuite({
      before: iteration(0.2, [{ findingId: "f1", rate: 0.5 }, { findingId: "f2", rate: 0.9 }]),
      after: iteration(0.2, [{ findingId: "f3", rate: 1 }, { findingId: "f1", rate: 0.9 }]), noiseBand: 0,
    })).toEqual({ regressions: [], passed: true });
  });

  it("reports both conflict and finding regressions without changing its inputs", () => {
    const before = iteration(0, [{ findingId: "f1", rate: 0 }]);
    const after = iteration(1, [{ findingId: "f1", rate: 1 }]);
    const original = structuredClone({ before, after });
    const result = compareSuite({ before, after, noiseBand: 0 });
    expect(result.passed).toBe(false);
    expect(result.regressions).toHaveLength(2);
    expect({ before, after }).toEqual(original);
  });
});
