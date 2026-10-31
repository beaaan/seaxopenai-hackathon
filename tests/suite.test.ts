import { describe, expect, it } from "vitest";
import { compareSuite as compareWithFidelity } from "../src/pipeline/suite";
import type { FidelityResult, Iteration } from "../src/shared/schema";

type Repro = { findingId: string; rate: number; n?: number; noiseBand?: number | null };
type Args = { before: Iteration; after: Iteration; noiseBand: number; conflictMeasured: boolean };

/** Wording-preserving edits: the fidelity check passed or was not run. */
const compareSuite = (args: Args) => compareWithFidelity({ ...args, fidelity: null });

function iteration(conflictRate: number, findingReproduction: Repro[] = [], overrides: Partial<Iteration> = {}): Iteration {
  return {
    policyVersion: 0, readings: 10, conflictRate, ci95: { lo: 0, hi: 1 }, openQuestionRate: 0, openWordingFindings: 0,
    findingReproduction: findingReproduction.map((finding) => ({ findingId: finding.findingId, rate: finding.rate, n: finding.n ?? 10, noiseBand: finding.noiseBand === undefined ? 0.1 : finding.noiseBand })),
    noiseBand: 0.1, noiseBandScenarios: 10, decision: "stop", reason: "test", ...overrides,
  };
}

describe("compareSuite fidelity gate", () => {
  it("fails an edit that adds a commitment even when every misreading fell", () => {
    const fidelity: FidelityResult = { passed: false, facts: [{ factId: "help.4", entailed: true, why: "kept" }], newCommitments: ["cash buyers can pay at convenience stores"], requiresNewFact: null };
    const result = compareWithFidelity({
      before: iteration(0, [{ findingId: "f1", rate: 0.9 }]), after: iteration(0, [{ findingId: "f1", rate: 0.1 }]),
      noiseBand: 0, conflictMeasured: false, fidelity,
    });
    expect(result.verdict).toBe("fail");
    expect(result.reasons[0]).toBe("edit adds a commitment the original never made: cash buyers can pay at convenience stores");
    expect(result.reasons).toContain("f1 90% → 10% fell beyond noise ±10.0 pp");
  });
});

describe("compareSuite with a reference", () => {
  it("fails when the conflict rate rises beyond its band, and passes at or below it", () => {
    expect(compareSuite({ before: iteration(0.2), after: iteration(0.4), noiseBand: 0.1, conflictMeasured: true }).verdict).toBe("fail");
    for (const rate of [0.1, 0.3, 0.4]) {
      expect(compareSuite({ before: iteration(0.3), after: iteration(rate), noiseBand: 0.1, conflictMeasured: true }).verdict).toBe("pass");
    }
  });

  it("fails when any finding rises beyond its own noise band, even if conflicts fell", () => {
    const result = compareSuite({
      before: iteration(0.4, [{ findingId: "f1", rate: 0.3 }, { findingId: "f2", rate: 0.5 }]),
      after: iteration(0.1, [{ findingId: "f1", rate: 0.45 }, { findingId: "f2", rate: 0.55 }]),
      noiseBand: 0.1, conflictMeasured: true,
    });
    expect(result.verdict).toBe("fail");
    expect(result.reasons[0]).toMatch(/^f1 30% → 45% rose beyond noise/);
  });

  it.each([null, 0, 1, 4])("is inconclusive with %s test–retest pairs on either side", (count) => {
    for (const side of ["before", "after"] as const) {
      const args = { before: iteration(0.1), after: iteration(0.1), noiseBand: 0, conflictMeasured: true };
      args[side] = iteration(0.1, [], { noiseBandScenarios: count });
      expect(compareSuite(args).verdict).toBe("inconclusive");
    }
  });

  it("accepts exactly five pairs", () => {
    const five = { readings: 5, noiseBandScenarios: 5 };
    expect(compareSuite({ before: iteration(0, [], five), after: iteration(0, [], five), noiseBand: 0, conflictMeasured: true }).verdict).toBe("pass");
  });

  it("is inconclusive when a finding measured before is unmeasured after, or cohorts differ", () => {
    expect(compareSuite({ before: iteration(0, [{ findingId: "f1", rate: 0.5 }]), after: iteration(0, [{ findingId: "f1", rate: 0, n: 0 }]), noiseBand: 0, conflictMeasured: true }).verdict).toBe("inconclusive");
    expect(compareSuite({ before: iteration(0), after: iteration(0, [], { readings: 9 }), noiseBand: 0, conflictMeasured: true }).verdict).toBe("inconclusive");
  });

  it("does not block on findings the selected scenarios never covered", () => {
    const result = compareSuite({ before: iteration(0, [{ findingId: "f1", rate: 0, n: 0 }]), after: iteration(0, [{ findingId: "f1", rate: 0, n: 0 }]), noiseBand: 0, conflictMeasured: true });
    expect(result.verdict).toBe("pass");
    expect(result.reasons).toContain("f1 not covered by these scenarios");
  });
});

describe("compareSuite without a reference", () => {
  it("passes only when some finding fell beyond its noise band", () => {
    const result = compareSuite({
      before: iteration(0, [{ findingId: "f1", rate: 0.9 }, { findingId: "f2", rate: 0.5 }]),
      after: iteration(0, [{ findingId: "f1", rate: 0.6 }, { findingId: "f2", rate: 0.55 }]),
      noiseBand: 0, conflictMeasured: false,
    });
    expect(result.verdict).toBe("pass");
    expect(result.reasons[0]).toMatch(/^f1 90% → 60% fell beyond noise/);
    expect(result.reasons).toContain("no reference: conflict rate not measured");
  });

  it("is inconclusive when nothing moved beyond noise, including a change exactly equal to the band", () => {
    expect(compareSuite({ before: iteration(0, [{ findingId: "f1", rate: 0.5 }]), after: iteration(0, [{ findingId: "f1", rate: 0.4 }]), noiseBand: 0, conflictMeasured: false }).verdict).toBe("inconclusive");
  });

  it("never judges a finding without a noise estimate", () => {
    const result = compareSuite({
      before: iteration(0, [{ findingId: "f1", rate: 1, noiseBand: null }]),
      after: iteration(0, [{ findingId: "f1", rate: 0, noiseBand: null }]),
      noiseBand: 0, conflictMeasured: false,
    });
    expect(result.verdict).toBe("inconclusive");
    expect(result.reasons.join(" ")).toMatch(/no noise estimate/);
  });
});
