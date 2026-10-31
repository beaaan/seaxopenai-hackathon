import type { ReactNode } from "react";
import type { EventType, RunEvent } from "@shared/events";
import type { FindingClass } from "@shared/schema";

export const EVENT_META: Record<EventType, { icon: string; label: string; tone: string }> = {
  "run.started": { icon: "▶", label: "run started", tone: "text-sky-700" },
  "policy.version": { icon: "📄", label: "policy version", tone: "text-indigo-700" },
  "dims.extracted": { icon: "🧭", label: "dimensions", tone: "text-indigo-700" },
  "scenario.created": { icon: "👤", label: "scenario", tone: "text-slate-600" },
  "reading.completed": { icon: "📖", label: "reading", tone: "text-slate-700" },
  "reading.failed": { icon: "⚠", label: "reading failed", tone: "text-red-700" },
  "grades.added": { icon: "✔", label: "grades", tone: "text-emerald-700" },
  "codings.added": { icon: "▦", label: "codings", tone: "text-sky-700" },
  "clusters.updated": { icon: "◎", label: "clusters", tone: "text-amber-700" },
  "codebook.fixed": { icon: "▦", label: "codebook fixed", tone: "text-sky-800" },
  "allocation.decided": { icon: "⚖", label: "allocation", tone: "text-violet-700" },
  "findings.updated": { icon: "🔎", label: "findings", tone: "text-rose-700" },
  "rewrite.proposed": { icon: "✎", label: "rewrite", tone: "text-indigo-700" },
  "rewrite.approved": { icon: "✅", label: "rewrite approved", tone: "text-emerald-700" },
  "iteration.completed": { icon: "↻", label: "iteration", tone: "text-sky-700" },
  "stop.decided": { icon: "■", label: "stop", tone: "text-sky-800" },
  "thread.item": { icon: "💬", label: "thread item", tone: "text-slate-500" },
  "baseline.completed": { icon: "📋", label: "baseline", tone: "text-slate-700" },
  "score.completed": { icon: "🏁", label: "score", tone: "text-emerald-800" },
  "human.question": { icon: "❓", label: "human question", tone: "text-orange-700" },
  "human.answer": { icon: "🙋", label: "human answer", tone: "text-orange-700" },
  "human.mapped": { icon: "🔗", label: "human mapped", tone: "text-orange-700" },
  "probe.completed": { icon: "↗", label: "incentive probe", tone: "text-amber-800" },
  "suite.compared": { icon: "=", label: "suite comparison", tone: "text-indigo-800" },
  log: { icon: "·", label: "log", tone: "text-slate-500" },
  "run.completed": { icon: "🏁", label: "run completed", tone: "text-emerald-800" },
  "run.failed": { icon: "✖", label: "run failed", tone: "text-red-800" },
};

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function eventSummary(event: RunEvent): string {
  switch (event.type) {
    case "run.started":
      return `${event.payload.config.policyId} · budget ${event.payload.config.budget} · seed ${event.payload.config.seedSize}`;
    case "policy.version":
      return `v${event.payload.policy.version} · ${event.payload.policy.sentences.length} sentences`;
    case "dims.extracted":
      return event.payload.dimensions.map((d) => d.name).join(", ");
    case "scenario.created":
      return `${event.payload.scenario.id} · ${event.payload.scenario.persona.name} · batch ${event.payload.scenario.batch}`;
    case "reading.completed":
      return `${event.payload.reading.scenarioId} · ${event.payload.reading.interpretations.length} interpretations · ${event.payload.reading.paraphraseVi}`;
    case "reading.failed":
      return `${event.payload.scenarioId}: ${event.payload.error}`;
    case "grades.added": {
      let conflicts = 0;
      let confidenceSum = 0;
      let pConflictsSum = 0;
      let pConflictsCount = 0;
      for (const grade of event.payload.grades) {
        if (grade.label === "conflicts") conflicts += 1;
        confidenceSum += grade.confidence;
        if (grade.pConflicts !== null) {
          pConflictsSum += grade.pConflicts;
          pConflictsCount += 1;
        }
      }
      const confidence = event.payload.grades.length === 0 ? null : confidenceSum / event.payload.grades.length;
      return `${event.payload.grades.length} grades · ${conflicts} conflicts · mean confidence ${confidence === null ? "—" : pct(confidence)}${pConflictsCount === 0 ? "" : ` · mean P(conflict)=${(pConflictsSum / pConflictsCount).toFixed(2)}`}`;
    }
    case "clusters.updated":
      return `v${event.payload.policyVersion} · ${event.payload.clusters.length} clusters`;
    case "codebook.fixed":
      return `v${event.payload.codebookVersion} · ${event.payload.clusterIds.length} frozen beliefs`;
    case "allocation.decided":
      return `batch ${event.payload.decision.batch} · focus ${event.payload.decision.focusDimIds.join(", ") || "none"} · n=${event.payload.decision.n}`;
    case "findings.updated":
      return `${event.payload.findings.length} findings`;
    case "rewrite.proposed":
      return `v${event.payload.rewrite.fromVersion} → v${event.payload.rewrite.toVersion} · ${event.payload.rewrite.edits.length} edits · fidelity ${event.payload.rewrite.fidelity.passed ? "passed" : "failed"}`;
    case "rewrite.approved":
      return `v${event.payload.version} by ${event.payload.approvedBy}`;
    case "iteration.completed":
      return `v${event.payload.iteration.policyVersion} · conflict ${pct(event.payload.iteration.conflictRate)} · ${event.payload.iteration.decision}`;
    case "stop.decided":
      return `final v${event.payload.finalVersion} · ${event.payload.reason}`;
    case "thread.item":
      return `${event.payload.record.role} · ${event.payload.record.itemType} · ${event.payload.record.label}`;
    case "baseline.completed":
      return `${event.payload.run.id} · ${event.payload.run.issues.length} issues`;
    case "score.completed":
      return event.payload.score.systems.map((s) => `${s.label} ${pct(s.recall)}`).join(" · ");
    case "human.question":
      return event.payload.question.questionVi;
    case "human.answer":
      return `${event.payload.answer.respondent}: ${event.payload.answer.answerVi}`;
    case "human.mapped":
      return `${event.payload.mapping.answerId} → ${event.payload.mapping.findingId ?? "no finding"}`;
    case "probe.completed":
      return `${event.payload.result.assumptions.length} assumptions · ${event.payload.result.steps.length} steps · ${event.payload.result.summary}`;
    case "suite.compared":
      return `${event.payload.comparison.verdict.toUpperCase()} · ${pct(event.payload.comparison.before.conflictRate)} → ${pct(event.payload.comparison.after.conflictRate)} · suite ${event.payload.comparison.suiteRunId}`;
    case "log":
      return `[${event.payload.level}] ${event.payload.message}`;
    case "run.completed":
      return event.payload.summary;
    case "run.failed":
      return event.payload.error;
    case "codings.added":
      return `v${event.payload.policyVersion} × codebook v${event.payload.codebookVersion}: ${event.payload.codings.length} codings`;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

export const FINDING_CLASS_META: Record<FindingClass, { label: string; className: string }> = {
  wording_fix: { label: "wording fix", className: "bg-emerald-100 text-emerald-800 ring-emerald-300" },
  design_gap: { label: "design gap", className: "bg-amber-100 text-amber-900 ring-amber-300" },
  unresolvable: { label: "unresolvable", className: "bg-slate-200 text-slate-800 ring-slate-400" },
};

export function Badge(props: { className: string; children: ReactNode }): ReactNode {
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ring-1 ${props.className}`}>{props.children}</span>;
}

export function SectionTitle(props: { children: ReactNode; right?: ReactNode }): ReactNode {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="text-sm font-bold tracking-wide text-slate-500 uppercase">{props.children}</h2>
      {props.right}
    </div>
  );
}
