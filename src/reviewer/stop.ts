import type { Iteration } from "../shared/schema";

export interface StopDecisionArgs {
  history: Iteration[];
  current: Omit<Iteration, "decision" | "reason">;
  iterationIndex: number;
  maxIterations: number;
  fidelityFailures: number;
}

export interface StopDecision {
  decision: "continue" | "stop";
  reason: string;
}

export function stopDecision(args: StopDecisionArgs): StopDecision {
  const { current, fidelityFailures, iterationIndex, maxIterations } = args;
  if (fidelityFailures >= 2) return { decision: "stop", reason: `fidelity gate failed ${fidelityFailures} times (limit 2)` };
  if (current.openWordingFindings === 0) return { decision: "stop", reason: "0 open wording findings remain" };
  if (iterationIndex >= maxIterations) return { decision: "stop", reason: `iteration ${iterationIndex} reached maximum ${maxIterations}` };
  if (current.noiseBand !== null && (current.noiseBandScenarios === null || current.noiseBandScenarios < 5)) {
    return { decision: "stop", reason: `conflict-rate comparison is inconclusive: ${current.noiseBandScenarios ?? "unknown"} paired scenarios (minimum 5); noise band ${current.noiseBand.toFixed(2)}` };
  }
  const previous = args.history.at(-1);
  if (!previous) {
    return { decision: "continue", reason: `${current.openWordingFindings} open wording findings; iteration ${iterationIndex} of ${maxIterations}; no previous iteration to compare` };
  }
  if (current.noiseBand === null) {
    return { decision: "continue", reason: `${current.openWordingFindings} open wording findings; iteration ${iterationIndex} of ${maxIterations}; noise band is not yet measured` };
  }
  const improvement = previous.conflictRate - current.conflictRate;
  if (improvement < -current.noiseBand - Number.EPSILON) {
    return { decision: "stop", reason: `conflict rate rose ${previous.conflictRate.toFixed(2)} → ${current.conflictRate.toFixed(2)}, beyond the noise band ${current.noiseBand.toFixed(2)}; keeping the previous version` };
  }
  const comparison = `conflict rate ${previous.conflictRate.toFixed(2)} → ${current.conflictRate.toFixed(2)} (Δ ${improvement.toFixed(2)})`;
  // Rates are ratios; tolerate only floating-point roundoff at an equal boundary.
  if (improvement <= current.noiseBand + Number.EPSILON) {
    return { decision: "stop", reason: `${comparison} is within the noise band ${current.noiseBand.toFixed(2)}` };
  }
  return { decision: "continue", reason: `${comparison} exceeds the noise band ${current.noiseBand.toFixed(2)}; ${current.openWordingFindings} open wording findings remain` };
}
