/**
 * The UI is a pure function of the run log: `foldRun(events)` builds the whole view model in one
 * pass, and the selectors below derive everything the pages show. No pipeline logic lives here.
 */
import type { RunEvent } from "@shared/events";
import type {
  AllocationDecision, BaselineRun, Cluster, Coding, Dimension, Finding, Grade, HumanAnswer, HumanMapping, HumanQuestion,
  Iteration, PolicyVersion, ProbeResult, Reading, Rewrite, RunConfig, Scenario, Score, SuiteComparison, ThreadItemRecord,
} from "@shared/schema";

export type RunStatus = "running" | "completed" | "failed";

export interface Provenance {
  backends: string | null;
  decisions: "real" | "emulated" | null;
  embeddings: boolean | null;
}

export interface RunModel {
  runId: string;
  events: number;
  startedAt: string | null;
  config: RunConfig | null;
  status: RunStatus;
  summary: string | null;
  error: string | null;
  provenance: Provenance;
  versions: PolicyVersion[];
  dimensions: Dimension[];
  scenarios: Scenario[];
  readings: Reading[];
  failedReadings: number;
  grades: Grade[];
  codings: Coding[];
  clusters: Map<number, Cluster[]>;
  codebookIds: string[] | null;
  allocations: AllocationDecision[];
  findings: Finding[];
  rewrites: Rewrite[];
  approvals: Array<{ version: number; approvedBy: string }>;
  iterations: Iteration[];
  stop: { finalVersion: number; reason: string } | null;
  threads: ThreadItemRecord[];
  baselines: BaselineRun[];
  score: Score | null;
  questions: HumanQuestion[];
  answers: HumanAnswer[];
  mappings: HumanMapping[];
  probe: ProbeResult | null;
  comparison: SuiteComparison | null;
  logs: Array<{ level: "info" | "warn" | "error"; message: string }>;
}

export function emptyRun(runId: string): RunModel {
  return {
    runId, events: 0, startedAt: null, config: null, status: "running", summary: null, error: null,
    provenance: { backends: null, decisions: null, embeddings: null },
    versions: [], dimensions: [], scenarios: [], readings: [], failedReadings: 0, grades: [], codings: [],
    clusters: new Map(), codebookIds: null, allocations: [], findings: [], rewrites: [], approvals: [], iterations: [],
    stop: null, threads: [], baselines: [], score: null, questions: [], answers: [], mappings: [], probe: null,
    comparison: null, logs: [],
  };
}

/** Applies one event in place (the caller owns the model). */
export function applyEvent(m: RunModel, e: RunEvent): void {
  m.events += 1;
  switch (e.type) {
    case "run.started":
      m.config = e.payload.config;
      m.startedAt = e.ts;
      m.status = "running";
      break;
    case "policy.version":
      m.versions = [...m.versions.filter((v) => v.version !== e.payload.policy.version), e.payload.policy].sort((a, b) => a.version - b.version);
      break;
    case "dims.extracted":
      m.dimensions = e.payload.dimensions;
      break;
    case "scenario.created":
      m.scenarios.push(e.payload.scenario);
      break;
    case "reading.completed":
      m.readings.push(e.payload.reading);
      break;
    case "reading.failed":
      m.failedReadings += 1;
      break;
    case "grades.added":
      m.grades.push(...e.payload.grades);
      break;
    case "codings.added":
      m.codings.push(...e.payload.codings);
      break;
    case "clusters.updated":
      m.clusters.set(e.payload.policyVersion, e.payload.clusters);
      break;
    case "codebook.fixed":
      m.codebookIds = e.payload.clusterIds;
      break;
    case "allocation.decided":
      m.allocations.push(e.payload.decision);
      break;
    case "findings.updated":
      m.findings = e.payload.findings;
      break;
    case "rewrite.proposed":
      m.rewrites.push(e.payload.rewrite);
      break;
    case "rewrite.approved":
      m.approvals.push(e.payload);
      break;
    case "iteration.completed":
      m.iterations.push(e.payload.iteration);
      break;
    case "stop.decided":
      m.stop = e.payload;
      break;
    case "thread.item":
      m.threads.push(e.payload.record);
      break;
    case "baseline.completed":
      m.baselines.push(e.payload.run);
      break;
    case "score.completed":
      m.score = e.payload.score;
      break;
    case "human.question":
      m.questions.push(e.payload.question);
      break;
    case "human.answer":
      m.answers.push(e.payload.answer);
      break;
    case "human.mapped":
      m.mappings = [...m.mappings.filter((x) => x.answerId !== e.payload.mapping.answerId), e.payload.mapping];
      break;
    case "probe.completed":
      m.probe = e.payload.result;
      break;
    case "suite.compared":
      m.comparison = e.payload.comparison;
      break;
    case "log": {
      m.logs.push(e.payload);
      const msg = e.payload.message;
      if (msg.startsWith("Backends: ")) m.provenance.backends = msg.slice("Backends: ".length);
      else if (msg.startsWith("Decisions: ")) m.provenance.decisions = msg.includes("EMULATED") ? "emulated" : "real";
      else if (msg.startsWith("Embeddings: ")) m.provenance.embeddings = msg.endsWith("yes");
      break;
    }
    case "run.completed":
      m.status = "completed";
      m.summary = e.payload.summary;
      break;
    case "run.failed":
      m.status = "failed";
      m.error = e.payload.error;
      break;
  }
}

export function foldRun(runId: string, events: readonly RunEvent[]): RunModel {
  const m = emptyRun(runId);
  for (const e of events) applyEvent(m, e);
  return m;
}

// ---------------------------------------------------------------------------
// Selectors

/** v0 readings of the original cohort (no re-read / repair tags). */
export function originalReadings(m: RunModel, version = 0): Reading[] {
  return m.readings.filter((r) => r.policyVersion === version && r.id === `r-${r.scenarioId}-v${version}`);
}

/** The frozen measurement codebook, or the latest v0 clusters while exploring. */
export function codebook(m: RunModel): Cluster[] {
  const v0 = m.clusters.get(0) ?? [];
  if (m.codebookIds === null) return v0;
  const ids = new Set(m.codebookIds);
  return v0.filter((c) => ids.has(c.id));
}

export function distinctReaders(cluster: Cluster): number {
  return new Set(cluster.readingIds).size;
}

/** A belief counts as a misreading signal when ≥ 2 distinct readers hold it. */
export function sharedBeliefs(clusters: readonly Cluster[]): Cluster[] {
  return clusters.filter((c) => distinctReaders(c) >= 2).sort((a, b) => distinctReaders(b) - distinctReaders(a) || b.conflictShare - a.conflictShare);
}

/** How many readers counts are measured against: the original cohort. */
export function cohortSize(m: RunModel): number {
  return originalReadings(m).length || m.scenarios.length;
}

/** One wrong idea readers came away with: a named finding, or, before findings exist, a belief two or more readers share. */
export interface Misreading {
  id: string;
  title: string;
  /** null for an unnamed shared belief (exploration runs, or before findings are written). */
  kind: Finding["class"] | null;
  summary: string | null;
  sentenceIds: string[];
  /** Scenario ids of the readers who hold it. */
  readers: string[];
  interpretationIds: string[];
}

/** Misreadings, most-held first. */
export function misreadings(m: RunModel): Misreading[] {
  const scenarioOf = new Map(m.readings.map((r) => [r.id, r.scenarioId]));
  const scenariosOf = (readingIds: readonly string[]): string[] => [...new Set(readingIds.map((id) => scenarioOf.get(id) ?? id))];
  const clusters = codebook(m);
  const byId = new Map(clusters.map((c) => [c.id, c]));
  const rows: Misreading[] = m.findings.length > 0
    ? m.findings.map((f) => ({
      id: f.id, title: f.title, kind: f.class, summary: f.readingSummary, sentenceIds: f.sentenceIds,
      readers: scenariosOf(f.evidence.readingIds),
      interpretationIds: f.evidence.clusterIds.flatMap((id) => byId.get(id)?.interpretationIds ?? []),
    }))
    : sharedBeliefs(clusters).map((c) => ({
      id: c.id, title: c.labelEn, kind: null, summary: null, sentenceIds: c.sentenceId === null ? [] : [c.sentenceId],
      readers: scenariosOf(c.readingIds), interpretationIds: c.interpretationIds,
    }));
  return rows.sort((a, b) => b.readers.length - a.readers.length);
}

export function scenarioById(m: RunModel): Map<string, Scenario> {
  return new Map(m.scenarios.map((s) => [s.id, s]));
}

export function hasReference(m: RunModel): boolean {
  return m.config !== null && m.config.inputs.referenceSha256 !== null;
}

export function finalVersion(m: RunModel): number {
  return m.stop?.finalVersion ?? m.versions.at(-1)?.version ?? 0;
}

/** The accepted rewrite into `toVersion` (last one whose fidelity passed). */
export function acceptedRewrite(m: RunModel, toVersion: number): Rewrite | null {
  return m.rewrites.findLast((r) => r.toVersion === toVersion && r.fidelity.passed) ?? null;
}

export const CLASS_LABEL: Record<Finding["class"], string> = {
  wording_fix: "Fixable by rewording",
  design_gap: "Needs a rule decision",
  unresolvable: "Text lacks the information",
};

/** What each kind means for the person who owns the text. */
export const CLASS_MEANING: Record<Finding["class"], string> = {
  wording_fix: "Rewording fixed it: the same readers stopped believing it, and no rule changed.",
  design_gap: "Fixing it means changing or stating a rule. The policy owner has to decide.",
  unresolvable: "Readers need a fact the text does not give, such as a number, a deadline or a next step.",
};

export const STAGES = [
  { id: "sample", label: "Choose readers", done: (m: RunModel) => m.scenarios.length > 0 },
  { id: "read", label: "Readers read the text", done: (m: RunModel) => m.readings.length > 0 },
  { id: "codebook", label: "Group what they believe", done: (m: RunModel) => m.codebookIds !== null },
  { id: "findings", label: "Name the misreadings", done: (m: RunModel) => m.findings.length > 0 },
  { id: "rewrite", label: "Rewrite and read again", done: (m: RunModel) => m.stop !== null },
  { id: "evaluate", label: "Compare with one AI review", done: (m: RunModel) => m.status === "completed" },
] as const;
