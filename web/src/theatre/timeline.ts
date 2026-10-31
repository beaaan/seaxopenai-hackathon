import type { RunEvent } from "@shared/events";

/** Pipeline stages, in the order a run moves through them. */
export const STAGES = [
  { id: "text", label: "Policy text" },
  { id: "readers", label: "Readers" },
  { id: "reading", label: "Reading" },
  { id: "grading", label: "Grading" },
  { id: "clustering", label: "Clustering" },
  { id: "agent", label: "Agent steers" },
  { id: "findings", label: "Misreadings" },
  { id: "benchmark", label: "Benchmark" },
  { id: "persona", label: "Persona lives it" },
] as const;
export type StageId = (typeof STAGES)[number]["id"];

export function stageOf(e: RunEvent): StageId | null {
  switch (e.type) {
    case "policy.version":
    case "dims.extracted":
      return "text";
    case "scenario.created":
      return "readers";
    case "reading.completed":
      return "reading";
    case "grades.added":
      return "grading";
    case "clusters.updated":
    case "codings.added":
    case "codebook.fixed":
      return "clustering";
    case "thread.item":
      return e.payload.record.role === "probe" ? "persona" : "agent";
    case "allocation.decided":
      return "agent";
    case "findings.updated":
    case "iteration.completed":
    case "stop.decided":
      return "findings";
    case "baseline.completed":
    case "score.completed":
      return "benchmark";
    default:
      return null;
  }
}

export function isRetestReading(e: RunEvent): boolean {
  return e.type === "reading.completed" && e.payload.reading.id.endsWith("-rt");
}

/**
 * Seconds each event holds the screen at 1× speed. A real run takes about fifteen minutes; this plays it in about a
 * minute and a half while giving the moments that matter (the agent deciding, findings landing) time to be read.
 */
function dwell(e: RunEvent): number {
  switch (e.type) {
    case "run.started":
      return 1.2;
    case "policy.version":
      return 2.2;
    case "dims.extracted":
      return 1.8;
    case "scenario.created":
      return 0.16;
    case "reading.completed":
      return isRetestReading(e) ? 0.07 : 0.34;
    case "grades.added":
      return 0.9;
    case "clusters.updated":
      return 1.6;
    case "codings.added":
      return 0.2;
    case "thread.item": {
      const r = e.payload.record;
      if (r.role === "probe") return r.itemType === "agentMessage" ? 0.75 : r.itemType === "dynamicToolCall" ? 0.7 : 0.15;
      if (r.itemType === "dynamicToolCall") return 0.55;
      if (r.itemType === "agentMessage") return 1.4;
      return 0.25;
    }
    case "allocation.decided":
      return 3;
    case "codebook.fixed":
      return 1;
    case "findings.updated":
      return 4.5;
    case "iteration.completed":
      return 1.4;
    case "baseline.completed":
      return 0.9;
    case "score.completed":
      return 3.2;
    case "run.completed":
      return 2;
    default:
      return 0.05;
  }
}

/** Start time (seconds at 1×) of each event; appending events extends the schedule without moving earlier ones. */
export function schedule(events: readonly RunEvent[], from: number[] = []): number[] {
  const at = from.slice(0, events.length);
  let t = at.length ? at[at.length - 1]! + dwell(events[at.length - 1]!) : 0.6;
  for (let i = at.length; i < events.length; i++) {
    at.push(t);
    t += dwell(events[i]!);
  }
  return at;
}

export function endOf(events: readonly RunEvent[], at: readonly number[]): number {
  const last = events.length - 1;
  return last < 0 ? 0 : at[last]! + dwell(events[last]!);
}
