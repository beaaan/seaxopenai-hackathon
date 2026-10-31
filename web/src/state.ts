/**
 * The UI is a pure function of the event log: every view reads a `RunView` produced by
 * `foldEvents` over the revealed prefix (replay) or everything received so far (live).
 */
import type { RunEvent } from "@shared/events";
import type {
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
  Interpretation,
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
} from "@shared/schema";

export type RunStatus = "empty" | "running" | "completed" | "failed";

export interface LogLine {
  seq: number;
  level: "info" | "warn" | "error";
  message: string;
}

export interface InterpretationRef {
  interpretation: Interpretation;
  readingId: string;
  scenarioId: string;
}

export interface RunView {
  runId: string | null;
  lastSeq: number;
  status: RunStatus;
  summary: string | null;
  error: string | null;
  config: RunConfig | null;
  versions: Record<number, PolicyVersion>;
  currentVersion: number | null;
  dimensions: Dimension[];
  scenarios: Record<string, Scenario>;
  readings: Record<string, Reading>;
  /** interpretation id → where it came from */
  interpretations: Record<string, InterpretationRef>;
  failedReadings: { scenarioId: string; policyVersion: number; error: string }[];
  /** keyed by interpretation id */
  grades: Record<string, Grade>;
  /** codebook probabilities, keyed by policy version of the coded readings */
  codings: Record<number, Coding[]>;
  clusters: Record<number, Cluster[]>;
  codebookVersion: number | null;
  codebookClusterIds: string[];
  allocations: AllocationDecision[];
  findings: Finding[];
  rewrites: Rewrite[];
  approvals: { version: number; approvedBy: string }[];
  iterations: Iteration[];
  stop: { finalVersion: number; reason: string } | null;
  threadItems: ThreadItemRecord[];
  baselines: BaselineRun[];
  score: Score | null;
  humanQuestions: HumanQuestion[];
  humanAnswers: HumanAnswer[];
  humanMappings: HumanMapping[];
  probe: ProbeResult | null;
  comparison: SuiteComparison | null;
  log: LogLine[];
}

export const EMPTY_VIEW: RunView = {
  runId: null,
  lastSeq: -1,
  status: "empty",
  summary: null,
  error: null,
  config: null,
  versions: {},
  currentVersion: null,
  dimensions: [],
  scenarios: {},
  readings: {},
  interpretations: {},
  failedReadings: [],
  grades: {},
  codings: {},
  clusters: {},
  codebookVersion: null,
  codebookClusterIds: [],
  allocations: [],
  findings: [],
  rewrites: [],
  approvals: [],
  iterations: [],
  stop: null,
  threadItems: [],
  baselines: [],
  score: null,
  humanQuestions: [],
  humanAnswers: [],
  humanMappings: [],
  probe: null,
  comparison: null,
  log: [],
};

export function applyEvent(view: RunView, event: RunEvent): RunView {
  const base: RunView = {
    ...view,
    runId: event.runId,
    lastSeq: event.seq,
    status: view.status === "empty" ? "running" : view.status,
  };
  switch (event.type) {
    case "run.started":
      return { ...base, config: event.payload.config, status: "running" };
    case "policy.version": {
      const policy = event.payload.policy;
      const current = base.currentVersion === null ? policy.version : Math.max(base.currentVersion, policy.version);
      return { ...base, versions: { ...base.versions, [policy.version]: policy }, currentVersion: current };
    }
    case "dims.extracted":
      return { ...base, dimensions: event.payload.dimensions };
    case "scenario.created": {
      const scenario = event.payload.scenario;
      return { ...base, scenarios: { ...base.scenarios, [scenario.id]: scenario } };
    }
    case "reading.completed": {
      const reading = event.payload.reading;
      const interpretations = { ...base.interpretations };
      for (const interpretation of reading.interpretations) {
        interpretations[interpretation.id] = { interpretation, readingId: reading.id, scenarioId: reading.scenarioId };
      }
      return { ...base, readings: { ...base.readings, [reading.id]: reading }, interpretations };
    }
    case "reading.failed":
      return { ...base, failedReadings: [...base.failedReadings, event.payload] };
    case "grades.added": {
      const grades = { ...base.grades };
      for (const grade of event.payload.grades) grades[grade.interpretationId] = grade;
      return { ...base, grades };
    }
    case "clusters.updated":
      return { ...base, clusters: { ...base.clusters, [event.payload.policyVersion]: event.payload.clusters } };
    case "codebook.fixed":
      return { ...base, codebookVersion: event.payload.codebookVersion, codebookClusterIds: event.payload.clusterIds };
    case "allocation.decided":
      return { ...base, allocations: [...base.allocations, event.payload.decision] };
    case "findings.updated":
      return { ...base, findings: event.payload.findings };
    case "rewrite.proposed":
      return { ...base, rewrites: [...base.rewrites, event.payload.rewrite] };
    case "rewrite.approved":
      return { ...base, approvals: [...base.approvals, event.payload] };
    case "iteration.completed":
      return { ...base, iterations: [...base.iterations, event.payload.iteration] };
    case "stop.decided":
      return { ...base, stop: event.payload };
    case "thread.item":
      return { ...base, threadItems: [...base.threadItems, event.payload.record] };
    case "baseline.completed":
      return { ...base, baselines: [...base.baselines, event.payload.run] };
    case "score.completed":
      return { ...base, score: event.payload.score };
    case "human.question":
      return { ...base, humanQuestions: [...base.humanQuestions, event.payload.question] };
    case "human.answer":
      return { ...base, humanAnswers: [...base.humanAnswers, event.payload.answer] };
    case "human.mapped":
      return { ...base, humanMappings: [...base.humanMappings, event.payload.mapping] };
    case "probe.completed":
      return { ...base, probe: event.payload.result };
    case "suite.compared":
      return { ...base, comparison: event.payload.comparison };
    case "log":
      return { ...base, log: [...base.log, { seq: event.seq, ...event.payload }] };
    case "run.completed":
      return { ...base, status: "completed", summary: event.payload.summary };
    case "run.failed":
      return { ...base, status: "failed", error: event.payload.error };
    case "codings.added": {
      const v = event.payload.policyVersion;
      return { ...base, codings: { ...base.codings, [v]: [...(base.codings[v] ?? []), ...event.payload.codings] } };
    }
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

export function foldEvents(events: readonly RunEvent[]): RunView {
  return events.reduce(applyEvent, EMPTY_VIEW);
}

/** Latest cluster with this id across versions (findings reference clusters by id). */
export function findCluster(view: RunView, clusterId: string): Cluster | null {
  const versions = Object.keys(view.clusters)
    .map(Number)
    .sort((a, b) => b - a);
  for (const v of versions) {
    const hit = view.clusters[v]?.find((c) => c.id === clusterId);
    if (hit !== undefined) return hit;
  }
  return null;
}
