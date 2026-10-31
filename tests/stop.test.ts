import { describe, expect, it } from "vitest";
import { stopDecision, type StopDecisionArgs } from "../src/reviewer/stop";
import type { Iteration } from "../src/shared/schema";

function current(overrides: Partial<Omit<Iteration, "decision" | "reason">> = {}): Omit<Iteration, "decision" | "reason"> {
  return { policyVersion: 1, readings: 100, conflictRate: 0.19, ci95: { lo: 0.1, hi: 0.3 }, openQuestionRate: 0.1, openWordingFindings: 2, findingReproduction: [], noiseBand: 0.05, noiseBandScenarios: 10, ...overrides };
}

function args(overrides: Partial<StopDecisionArgs> = {}): StopDecisionArgs {
  return { history: [{ ...current({ policyVersion: 0, conflictRate: 0.21 }), decision: "continue", reason: "initial" }], current: current(), iterationIndex: 1, maxIterations: 3, fidelityFailures: 0, ...overrides };
}

describe("stopDecision", () => {
  it("prioritizes two fidelity failures over every other rule", () => {
    expect(stopDecision(args({ fidelityFailures: 2, current: current({ openWordingFindings: 0 }), iterationIndex: 3 }))).toEqual({ decision: "stop", reason: "fidelity gate failed 2 times (limit 2)" });
    expect(stopDecision(args({ fidelityFailures: 4 }))).toEqual({ decision: "stop", reason: "fidelity gate failed 4 times (limit 2)" });
  });

  it("prioritizes no remaining wording findings over the iteration cap", () => {
    expect(stopDecision(args({ current: current({ openWordingFindings: 0 }), iterationIndex: 3 }))).toEqual({ decision: "stop", reason: "0 open wording findings remain" });
  });

  it("prioritizes the iteration cap over the noise comparison", () => {
    expect(stopDecision(args({ iterationIndex: 3 }))).toEqual({ decision: "stop", reason: "iteration 3 reached maximum 3" });
    expect(stopDecision(args({ iterationIndex: 4 }))).toEqual({ decision: "stop", reason: "iteration 4 reached maximum 3" });
  });

  it("reports before/after rates, delta and band when improvement is within noise", () => {
    expect(stopDecision(args())).toEqual({ decision: "stop", reason: "conflict rate 0.21 → 0.19 (Δ 0.02) is within the noise band 0.05" });
  });

  it("stops at an equal boundary despite ratio roundoff, and on regressions", () => {
    const history: Iteration[] = [{ ...current({ conflictRate: 0.4 }), decision: "continue", reason: "previous" }];
    expect(stopDecision(args({ history, current: current({ conflictRate: 0.3, noiseBand: 0.1 }) })).decision).toBe("stop");
    expect(stopDecision(args({ current: current({ conflictRate: 0.3 }) }))).toEqual({ decision: "stop", reason: "conflict rate 0.21 → 0.30 (Δ -0.09) is within the noise band 0.05" });
  });

  it("continues when improvement exceeds the measured noise", () => {
    expect(stopDecision(args({ current: current({ conflictRate: 0.1 }) }))).toEqual({ decision: "continue", reason: "conflict rate 0.21 → 0.10 (Δ 0.11) exceeds the noise band 0.05; 2 open wording findings remain" });
  });

  it("skips improvement comparisons with no history or no measured band", () => {
    expect(stopDecision(args({ history: [] }))).toEqual({ decision: "continue", reason: "2 open wording findings; iteration 1 of 3; no previous iteration to compare" });
    expect(stopDecision(args({ current: current({ noiseBand: null, noiseBandScenarios: null }) }))).toEqual({ decision: "continue", reason: "2 open wording findings; iteration 1 of 3; noise band is not yet measured" });
  });

  it("stops inconclusively with fewer than five paired scenarios", () => {
    expect(stopDecision(args({ current: current({ conflictRate: 0, noiseBand: 0, noiseBandScenarios: 4 }) }))).toEqual({ decision: "stop", reason: "conflict-rate comparison is inconclusive: 4 paired scenarios (minimum 5); noise band 0.00" });
    expect(stopDecision(args({ history: [], current: current({ noiseBandScenarios: 4 }) })).decision).toBe("stop");
    expect(stopDecision(args({ current: current({ noiseBandScenarios: 0 }) })).reason).toContain("inconclusive: 0 paired scenarios");
    expect(stopDecision(args({ current: current({ noiseBandScenarios: null }) })).reason).toContain("inconclusive: unknown paired scenarios");
    expect(stopDecision(args({ current: current({ conflictRate: 0, noiseBand: 0, noiseBandScenarios: 5 }) })).decision).toBe("continue");
  });
});
