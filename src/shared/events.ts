/**
 * The run event log: `runs/<runId>/events.jsonl`, one Event per line, append-only.
 * The UI is a pure function of this log, so live runs and replays share one code path.
 */
import { z } from "zod";
import {
  AllocationDecision,
  BaselineRun,
  Cluster,
  Coding,
  Dimension,
  Finding,
  Grade,
  HumanAnswer,
  HumanMapping,
  HumanQuestion,
  Iteration,
  PolicyVersion,
  ProbeResult,
  Reading,
  Rewrite,
  RunConfig,
  Scenario,
  Score,
  SuiteComparison,
  ThreadItemRecord,
} from "./schema";

export const EVENT_PAYLOADS = {
  "run.started": z.strictObject({ config: RunConfig }),
  "policy.version": z.strictObject({ policy: PolicyVersion }),
  "dims.extracted": z.strictObject({ dimensions: z.array(Dimension) }),
  "scenario.created": z.strictObject({ scenario: Scenario }),
  "reading.completed": z.strictObject({ reading: Reading }),
  "reading.failed": z.strictObject({ scenarioId: z.string(), policyVersion: z.number().int(), error: z.string() }),
  "grades.added": z.strictObject({ grades: z.array(Grade) }),
  /** Codebook probabilities (Decisions) for readings of one policy version against the clusters of `codebookVersion`. */
  "codings.added": z.strictObject({ policyVersion: z.number().int(), codebookVersion: z.number().int(), codings: z.array(Coding) }),
  /** Full replacement of the cluster set for one policy version. */
  "clusters.updated": z.strictObject({ policyVersion: z.number().int(), clusters: z.array(Cluster) }),
  /** The cluster set frozen as the measurement codebook; every later coding uses it. */
  "codebook.fixed": z.strictObject({ codebookVersion: z.number().int(), clusterIds: z.array(z.string()) }),
  "allocation.decided": z.strictObject({ decision: AllocationDecision }),
  /** Full replacement of the current findings. */
  "findings.updated": z.strictObject({ findings: z.array(Finding) }),
  "rewrite.proposed": z.strictObject({ rewrite: Rewrite }),
  "rewrite.approved": z.strictObject({ version: z.number().int(), approvedBy: z.string() }),
  "iteration.completed": z.strictObject({ iteration: Iteration }),
  "stop.decided": z.strictObject({ finalVersion: z.number().int(), reason: z.string() }),
  "thread.item": z.strictObject({ record: ThreadItemRecord }),
  "baseline.completed": z.strictObject({ run: BaselineRun }),
  "score.completed": z.strictObject({ score: Score }),
  "human.question": z.strictObject({ question: HumanQuestion }),
  "human.answer": z.strictObject({ answer: HumanAnswer }),
  "human.mapped": z.strictObject({ mapping: HumanMapping }),
  "probe.completed": z.strictObject({ result: ProbeResult }),
  "suite.compared": z.strictObject({ comparison: SuiteComparison }),
  log: z.strictObject({ level: z.enum(["info", "warn", "error"]), message: z.string() }),
  "run.completed": z.strictObject({ summary: z.string() }),
  "run.failed": z.strictObject({ error: z.string() }),
} as const;

export type EventType = keyof typeof EVENT_PAYLOADS;
export type EventPayload<T extends EventType> = z.infer<(typeof EVENT_PAYLOADS)[T]>;

const envelope = {
  seq: z.number().int().nonnegative(),
  ts: z.string(), // ISO-8601
  runId: z.string(),
};

function member(type: EventType): z.ZodObject {
  return z.strictObject({ ...envelope, type: z.literal(type), payload: EVENT_PAYLOADS[type] });
}

const members = (Object.keys(EVENT_PAYLOADS) as EventType[]).map(member) as [z.ZodObject, ...z.ZodObject[]];

/** Runtime validator for one log line. Use `parseEvent` to get the typed `RunEvent`. */
export const RunEventSchema = z.discriminatedUnion("type", members);

/** A typed event: `RunEventOf<"reading.completed">["payload"]["reading"]` etc. */
export type RunEventOf<T extends EventType> = {
  seq: number;
  ts: string;
  runId: string;
  type: T;
  payload: EventPayload<T>;
};
export type RunEvent = { [T in EventType]: RunEventOf<T> }[EventType];

export function parseEvent(value: unknown): RunEvent {
  return RunEventSchema.parse(value) as RunEvent;
}

/** Summary of a run for listings. */
export const RunSummary = z.strictObject({
  runId: z.string(),
  policyId: z.string().nullable(),
  events: z.number().int().nonnegative(),
  startedAt: z.string().nullable(),
  status: z.enum(["running", "completed", "failed", "unknown"]),
});
export type RunSummary = z.infer<typeof RunSummary>;
