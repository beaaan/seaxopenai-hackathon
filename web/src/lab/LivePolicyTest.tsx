import { useMemo, type CSSProperties, type ReactNode } from "react";
import { ArrowUpRight, Check, Loader2, Radio } from "lucide-react";
import type { Grade, GradeLabel, Reading } from "@shared/schema";
import { useRun } from "../hooks";
import { misreadings, originalReadings } from "../model";

type ReaderState = "waiting" | "reading" | "answered" | "graded" | "failed";
const GRADE_COLORS: Record<GradeLabel, string> = {
  consistent: "#4fd1a5", outside: "#ffb347", conflicts: "#ff6b6b", unclear: "#6b7784",
};
const GRADE_LABELS: Record<GradeLabel, string> = {
  consistent: "Fits the text", outside: "Not in the text", conflicts: "Contradicts it", unclear: "Unverified",
};
const GRADE_ORDER: readonly GradeLabel[] = ["consistent", "outside", "conflicts", "unclear"];
const STAGES = ["Readers read", "Beliefs checked", "Grouped", "Agent steers", "Misreadings"] as const;

export function LivePolicyTest({ runId, title }: { runId: string; title: string }): ReactNode {
  const { model, events, error } = useRun(runId, true);
  const readings = useMemo(() => model ? originalReadings(model) : [], [model]);
  const readingByScenario = useMemo(() => new Map(readings.map((reading) => [reading.scenarioId, reading])), [readings]);
  const gradesByReading = useMemo(() => {
    const result = new Map<string, Grade[]>();
    for (const grade of model?.grades ?? []) {
      const group = result.get(grade.readingId);
      if (group) group.push(grade);
      else result.set(grade.readingId, [grade]);
    }
    return result;
  }, [model]);
  const failed = useMemo(() => {
    const result = new Map<string, string>();
    for (const event of events) {
      if (event.type === "reading.failed" && event.payload.policyVersion === 0) result.set(event.payload.scenarioId, event.payload.error);
    }
    return result;
  }, [events]);
  const shared = useMemo(() => model ? misreadings(model) : [], [model]);
  const beliefs = readings.reduce((sum, reading) => sum + reading.interpretations.length, 0);
  const checks = readings.reduce((sum, reading) => sum + (gradesByReading.get(reading.id)?.length ?? 0), 0);
  const reached = [
    (model?.scenarios.length ?? 0) > 0,
    events.some((event) => event.type === "grades.added"),
    events.some((event) => event.type === "clusters.updated"),
    events.some((event) => event.type === "allocation.decided" || (event.type === "thread.item" && event.payload.record.role === "reviewer")),
    // Shared clusters may be correct beliefs. Only findings establish misreadings.
    (model?.findings.length ?? 0) > 0,
  ];
  const lastActivity = events.findLast((event) => ["scenario.created", "reading.completed", "grades.added", "clusters.updated", "allocation.decided", "thread.item", "findings.updated"].includes(event.type));
  let activeStage = -1;
  if (model?.status === "running" && lastActivity) {
    if (lastActivity.type === "scenario.created" || lastActivity.type === "reading.completed") activeStage = 0;
    else if (lastActivity.type === "grades.added") activeStage = 1;
    else if (lastActivity.type === "clusters.updated") activeStage = 2;
    else if (lastActivity.type === "allocation.decided" || lastActivity.type === "thread.item") activeStage = 3;
    else activeStage = 4;
  }
  const status = model?.status;
  const stateOf = (scenarioId: string, reading: Reading | undefined): ReaderState => {
    if (reading) return (gradesByReading.get(reading.id)?.length ?? 0) > 0 ? "graded" : "answered";
    if (failed.has(scenarioId)) return "failed";
    // exploreBatch emits each scenario immediately before dispatching the entire
    // batch in parallel. There is no per-reader started event, so this is batch
    // activity, never a simulated timer or invented completion.
    return model?.config && status === "running" ? "reading" : "waiting";
  };
  const stateCounts: Record<ReaderState, number> = { waiting: 0, reading: 0, answered: 0, graded: 0, failed: 0 };
  for (const scenario of model?.scenarios ?? []) stateCounts[stateOf(scenario.id, readingByScenario.get(scenario.id))] += 1;

  return (
    <section className="lab-live" aria-label="Live policy test">
      <div className="lab-run-heading">
        <div className="lab-run-title"><span className={`lab-status ${status ?? "connecting"}`}>{status === "completed" ? <Check aria-hidden /> : status === "failed" ? <Radio aria-hidden /> : <Loader2 className="spin" aria-hidden />}{status === "completed" ? "Test complete" : status === "failed" ? "Test stopped" : "Live test"}</span><h2>{title}</h2></div>
        <span className="lab-run-mode">{model?.config ? `Explore · Up to ${model.config.budget} readers` : "Connecting to live events…"}</span>
      </div>
      <ol className="lab-stages" aria-label="Stages reached in this run">
        {STAGES.map((label, index) => <li key={label} className={`${reached[index] ? "reached" : ""}${activeStage === index ? " active" : ""}`} aria-current={activeStage === index ? "step" : undefined}><span>{reached[index] && activeStage !== index ? <Check aria-hidden /> : index + 1}</span>{label}</li>)}
      </ol>
      <div className="lab-counters" aria-label="Live run counts">
        <div><strong>{model?.scenarios.length ?? 0}</strong><span>Readers</span></div>
        <div><strong>{beliefs}</strong><span>Beliefs</span></div>
        <div><strong>{checks}</strong><span>Checks</span></div>
        <p>Every dot is a real reader scenario.<br />Every count comes from the run log.</p>
      </div>
      <div className="lab-live-grid">
        <section className="lab-readers" aria-labelledby="lab-readers-title">
          <header><h3 id="lab-readers-title">The readers</h3><span>{stateCounts.reading} reading · {stateCounts.answered} answered · {stateCounts.graded} graded{stateCounts.failed > 0 ? ` · ${stateCounts.failed} failed` : ""}</span></header>
          <div className="lab-reader-grid">
            {(model?.scenarios ?? []).map((scenario) => {
              const reading = readingByScenario.get(scenario.id);
              const state = stateOf(scenario.id, reading);
              const grades = reading ? gradesByReading.get(reading.id) ?? [] : [];
              const counts: Record<GradeLabel, number> = { consistent: 0, outside: 0, conflicts: 0, unclear: 0 };
              for (const grade of grades) counts[grade.label] += 1;
              let angle = 0;
              const segments = GRADE_ORDER.flatMap((label) => {
                if (counts[label] === 0) return [];
                const from = angle;
                angle += (counts[label] / grades.length) * 360;
                return [`${GRADE_COLORS[label]} ${from}deg ${angle}deg`];
              });
              const style: CSSProperties | undefined = segments.length > 0 ? { background: `conic-gradient(${segments.join(", ")})` } : undefined;
              const details = grades.length > 0 ? GRADE_ORDER.filter((label) => counts[label] > 0).map((label) => `${counts[label]} ${GRADE_LABELS[label].toLowerCase()}`).join("; ") : failed.get(scenario.id) ?? state;
              return <div className={`lab-reader ${state}`} key={scenario.id} title={`${scenario.id}, ${state}: ${scenario.situationVi}\n${details}`} aria-label={`${scenario.id}, ${state}. ${details}`}><i style={style} aria-hidden /><span>{scenario.id}</span></div>;
            })}
          </div>
          {(model?.scenarios.length ?? 0) === 0 && <p className="lab-reader-empty">{status === "failed" ? "The run stopped before reader scenarios arrived." : "Preparing reader scenarios from the policy."}</p>}
          <div className="lab-grade-legend" aria-label="Belief grades">{GRADE_ORDER.map((label) => <span key={label}><i style={{ backgroundColor: GRADE_COLORS[label] }} />{GRADE_LABELS[label]}</span>)}</div>
          {model?.config?.inputs.referenceSha256 === null && <p className="lab-reference-note">This policy has no reference facts. Its beliefs remain unverified.</p>}
        </section>
        <section className="lab-shared" aria-labelledby="lab-shared-title">
          <header><h3 id="lab-shared-title">{model && model.findings.length > 0 ? "Top misreadings" : "Shared beliefs"}</h3><span>{shared.length > 0 ? `${shared.length} found` : "Awaiting grouping"}</span></header>
          {shared.length > 0 ? <ol>{shared.slice(0, 3).map((belief) => <li key={belief.id}><div className="lab-holder-count"><strong>{belief.readers.length}</strong><span>readers</span></div><p>{belief.title}</p></li>)}</ol> : <p className="lab-shared-empty">Beliefs appear here as soon as two or more readers share them.</p>}
          {model && model.findings.length === 0 && shared.length > 0 && <p className="lab-shared-note">A shared belief is not necessarily a misreading.</p>}
          {model?.allocations.at(-1) && <details className="lab-agent-note"><summary>Why the agent chose its next readers</summary><p>{model.allocations.at(-1)?.rationale}</p></details>}
        </section>
      </div>
      <footer className="lab-live-footer">
        <span>{status === "completed" ? "The report is ready." : status === "failed" ? "The events collected so far are still available." : "You can open the full run without stopping this test."}</span>
        <div><a className="lab-secondary" href={`#/live/${encodeURIComponent(runId)}`}>Watch the full run<ArrowUpRight aria-hidden /></a>{status === "completed" && <a className="lab-primary" href={`#/run/${encodeURIComponent(runId)}`}>Open the report<ArrowUpRight aria-hidden /></a>}</div>
      </footer>
      {(error || model?.error) && <p className="lab-error" role="alert">{error || model?.error}</p>}
    </section>
  );
}
