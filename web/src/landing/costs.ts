import type { RunModel } from "../model";
import usage from "./usage.json";

/** Real token usage from one instrumented run (scripts/usage-summary.ts → docs/usage-probe.json, copied here). */
interface StageUsage {
  stage: string;
  model: string;
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  costUsd: number;
}
interface UsageProbe {
  runId: string;
  readers: number;
  stages: StageUsage[];
  totalCostUsd: number;
  wallSeconds: number;
}
export const PROBE = usage as UsageProbe;

/** Stages whose work grows with the number of readers; the rest run a fixed number of times per test. */
const PER_READER = new Set(["reader", "grader", "coder", "embeddings", "decisions"]);

/**
 * Estimated cost of the stages for run `m`, from the measured probe: per-reader stages scale with the reader count,
 * single AI reviews with how many `m` ran on each model, everything else as measured. Null when nothing was measured.
 */
export function stageCost(stages: readonly string[], m: RunModel): { usd: number; model: string | null } | null {
  const rows = PROBE.stages.filter((s) => stages.includes(s.stage));
  if (rows.length === 0) return null;
  const scale = (s: StageUsage): number => {
    if (PER_READER.has(s.stage)) return m.scenarios.length / Math.max(1, PROBE.readers);
    if (s.stage === "baseline") return m.baselines.filter((b) => b.model === s.model).length / Math.max(1, s.calls);
    return 1;
  };
  return {
    usd: rows.reduce((sum, s) => sum + s.costUsd * scale(s), 0),
    model: [...rows].sort((a, b) => b.costUsd - a.costUsd)[0]?.model ?? null,
  };
}

/** Estimated model cost of the whole run `m`; every measured stage counts, including calls no pipeline layer names. */
export function runCost(m: RunModel): number {
  return stageCost(PROBE.stages.map((s) => s.stage), m)?.usd ?? 0;
}

/** Cost of one call of `stage` on `model`, as measured. */
function perCall(stage: string, model: string): number {
  const row = PROBE.stages.find((s) => s.stage === stage && s.model === model);
  return row && row.calls > 0 ? row.costUsd / row.calls : 0;
}

/** One more reading in the probe: reading it, grading it, coding it against the frozen groups (Decisions API). */
function perReading(): number {
  const readings = PROBE.stages.find((s) => s.stage === "reader")?.calls ?? 0;
  const rows = PROBE.stages.filter((s) => s.stage === "reader" || s.stage === "grader" || (s.stage === "coder" && s.model === "gpt-6-luna"));
  return readings > 0 ? rows.reduce((sum, s) => sum + s.costUsd, 0) / readings : 0;
}

/**
 * An edit test reuses the suite's earlier readings: one fresh reading per reader of the edited text, graded and coded
 * against the frozen groups, plus one fact check of the edit.
 */
export function editTestCost(readers: number): number {
  return perReading() * readers + perCall("fidelity", "gpt-6.1-sol");
}

/** One single-pass AI review of the policy. */
export function reviewCost(): number {
  return perCall("baseline", "gpt-6.1-sol");
}

export function usd(x: number): string {
  return x >= 1 ? `$${x.toFixed(2)}` : x >= 0.01 ? `${Math.round(x * 100)}¢` : "<1¢";
}
