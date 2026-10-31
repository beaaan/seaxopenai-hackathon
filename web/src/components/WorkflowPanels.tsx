import { useState, type FormEvent, type ReactNode } from "react";
import type { PolicyVersion, SuiteComparison } from "@shared/schema";
import { approveVersion, mapHumanAnswers, retestRun } from "../api";
import { findCluster, type RunView } from "../state";
import { pct } from "../ui";

export function CodebookPanel(props: { view: RunView }): ReactNode {
  const { view } = props;
  const versions = Object.keys(view.versions).map(Number).sort((a, b) => a - b);
  if (view.codebookVersion === null) return <p className="text-slate-600">The belief codebook has not been frozen yet.</p>;
  const readingIds = new Map(versions.map((version) => [version, new Set(Object.values(view.readings).filter((r) => r.policyVersion === version).map((r) => r.id))]));
  const means = new Map<string, { mean: number; n: number }>();
  for (const version of versions) {
    const ids = readingIds.get(version);
    for (const clusterId of view.codebookClusterIds) {
      const values = new Map<string, number>();
      for (const coding of view.codings[version] ?? []) {
        if (coding.clusterId === clusterId && ids?.has(coding.readingId)) values.set(coding.readingId, coding.probability);
      }
      if (values.size > 0) means.set(`${version}:${clusterId}`, { mean: [...values.values()].reduce((sum, n) => sum + n, 0) / values.size, n: values.size });
    }
  }
  return (
    <div className="space-y-3" data-testid="codebook-panel">
      <p className="text-slate-600">Fixed v{view.codebookVersion} belief statements · mean P(reading holds belief). The same instrument measures every version; green cells mark drops, not a judgement that every belief is wrong.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead><tr className="border-b-2 border-slate-200"><th className="p-3">Belief / Niềm tin</th>{versions.map((version) => <th key={version} className="min-w-36 p-3 text-right">v{version}<div className="text-sm font-normal text-slate-600">{readingIds.get(version)?.size ?? 0} readings</div></th>)}</tr></thead>
          <tbody>{view.codebookClusterIds.map((id) => {
            const cluster = findCluster(view, id);
            return <tr key={id} className="border-b border-slate-200 align-top"><th className="p-3 font-medium"><div>{cluster?.labelVi ?? id}</div><div className="mt-1 text-sm font-normal text-slate-600">{cluster?.labelEn}</div></th>{versions.map((version, index) => {
              const value = means.get(`${version}:${id}`);
              const previous = means.get(`${versions[index - 1]}:${id}`);
              const drop = value !== undefined && previous !== undefined ? previous.mean - value.mean : 0;
              return <td key={version} className={`p-3 text-right ${drop > 0 ? "bg-emerald-50 text-emerald-900" : ""}`}><div className="text-2xl font-bold tabular-nums">{value === undefined ? "—" : pct(value.mean)}</div>{drop > 0 && <div className="font-semibold">↓ {(drop * 100).toFixed(1)} pp</div>}{value !== undefined && <div className="text-xs text-slate-600">n = {value.n}</div>}</td>;
            })}</tr>;
          })}</tbody>
        </table>
      </div>
    </div>
  );
}

const SUITE_VERDICT_STYLE: Record<SuiteComparison["verdict"], string> = {
  pass: "border-emerald-400 bg-emerald-50",
  fail: "border-red-400 bg-red-50",
  inconclusive: "border-amber-400 bg-amber-50",
};

export function SuiteComparisonPanel(props: { comparison: SuiteComparison }): ReactNode {
  const c = props.comparison;
  const noise = c.after.noiseBand ?? c.before.noiseBand;
  const noiseScenarios = c.after.noiseBandScenarios ?? c.before.noiseBandScenarios;
  return (
    <section className={`rounded-xl border-2 p-5 ${SUITE_VERDICT_STYLE[c.verdict]}`} data-testid="suite-comparison">
      <div className="flex flex-wrap items-baseline justify-between gap-3"><h2 className="text-2xl font-bold">Policy CI · {c.verdict.toUpperCase()}</h2><span className="text-slate-700">Suite {c.suiteRunId} · baseline v{c.baseVersion}</span></div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-8 gap-y-2"><p className="text-xl">Conflict rate <strong className="text-3xl tabular-nums">{pct(c.before.conflictRate)} → {pct(c.after.conflictRate)}</strong></p><p>test–retest noise (paired): <strong>{noise === null ? "not measured" : `±${pct(noise)} (paired, n=${noiseScenarios ?? "unknown"})`}</strong></p></div>
      <p className="mt-2 text-sm text-slate-700">95% CI: before {pct(c.before.ci95.lo)}–{pct(c.before.ci95.hi)} · after {pct(c.after.ci95.lo)}–{pct(c.after.ci95.hi)} · {c.after.readings} re-test readings</p>
      <div className="mt-3 font-semibold">Reasons ({c.reasons.length})</div>
      {c.verdict === "pass" && c.reasons.length === 0 && <p>No regressions detected against the frozen suite.</p>}
      {c.reasons.length > 0 && <ul className="list-disc pl-6">{c.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
      <p className="mt-2 text-slate-700">{c.after.reason}</p>
    </section>
  );
}

export function RetestPanel(props: { runId: string; policy: PolicyVersion; onRun: (runId: string) => void }): ReactNode {
  const [surfaces, setSurfaces] = useState(props.policy.surfaces);
  const [smoke, setSmoke] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await retestRun(props.runId, surfaces, smoke);
      props.onRun(result.runId);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };
  return <form onSubmit={(event) => void submit(event)} className="space-y-4" data-testid="retest-panel">
    <div><h3 className="text-xl font-bold">Re-test edit</h3><p className="text-slate-600">Edit final v{props.policy.version}; compare against the same frozen scenarios and beliefs.</p></div>
    {surfaces.map((surface, index) => <label key={surface.id} className="block font-semibold">{surface.label}<textarea required rows={surface.text.length > 500 ? 10 : 4} className="mt-2 w-full rounded-lg border border-slate-300 bg-white p-3 font-normal leading-relaxed" value={surface.text} onChange={(event) => setSurfaces((current) => current.map((item, i) => i === index ? { ...item, text: event.target.value } : item))} /></label>)}
    <label className="flex items-center gap-3"><input type="checkbox" checked={smoke} onChange={(event) => setSmoke(event.target.checked)} className="size-5" />Smoke suite (smaller, faster); turn off for the full frozen suite.</label>
    <button disabled={busy} className="rounded-lg bg-indigo-700 px-5 py-3 font-bold text-white disabled:opacity-50" type="submit">{busy ? "Starting re-test…" : "Re-test edit"}</button>
    {error !== null && <p role="alert" className="text-red-800">{error}</p>}
  </form>;
}

export function ProbePanel(props: { view: RunView }): ReactNode {
  const probe = props.view.probe;
  if (probe === null) return <p className="text-slate-600">No incentive probe has completed for this run.</p>;
  const counts = [["COD orders", probe.outcome.codOrders], ["Refusals", probe.outcome.refusals], ["Locks", probe.outcome.locks], ["Refusals without lock", probe.outcome.refusalsWithoutLock], ["Accounts created", probe.outcome.accountsCreated]] as const;
  return <div className="space-y-5" data-testid="probe-panel">
    <section className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4"><h3 className="text-xl font-bold">Assumptions FIRST</h3><p className="mt-1 font-semibold text-amber-950">Assumptions, not Shopee's published rule</p><ul className="mt-3 space-y-2">{probe.assumptions.map((assumption) => <li key={assumption.id}><strong>{assumption.id}</strong> — {assumption.text}</li>)}</ul></section>
    <section><h3 className="text-xl font-bold">Hypothesis</h3><p className="mt-1">{probe.hypothesis}</p><p className="mt-2 text-slate-600">{probe.persona} · {probe.days} simulated days</p></section>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">{counts.map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3"><div className="text-3xl font-bold">{value}</div><div className="text-sm text-slate-600">{label}</div></div>)}</div>
    <p className="font-semibold">{probe.summary}</p>
    <section><h3 className="text-xl font-bold">Step timeline</h3><ol className="mt-3 space-y-3 border-l-2 border-indigo-200 pl-4">{probe.steps.map((step, index) => <li key={index} className="rounded-lg bg-slate-50 p-3"><div className="font-semibold">Day {step.day} · {step.tool}</div><div className="mt-1 break-words font-mono text-sm">Input: {step.argsJson}</div><div className="mt-1 break-words font-mono text-sm">Result: {step.resultJson}</div></li>)}</ol></section>
  </div>;
}

export function HumanPanel(props: { view: RunView; onRefresh: () => void }): ReactNode {
  const { view } = props;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = view.stop?.finalVersion ?? view.currentVersion;
  const url = view.runId === null ? null : `${window.location.origin}#/check/${encodeURIComponent(view.runId)}`;
  const act = async (action: "map" | "approve"): Promise<void> => {
    if (view.runId === null || version === null) return;
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      if (action === "map") await mapHumanAnswers(view.runId);
      else await approveVersion(view.runId, version);
      setMessage(action === "map" ? "Mapping started. Live events will show the result." : `Final v${version} approved by PM.`);
      props.onRefresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };
  return <div className="space-y-5" data-testid="human-panel">
    <div><h3 className="text-xl font-bold">Human check · Kiểm tra với người thật</h3><p className="mt-1 text-slate-600">Share this link. Respondents read v0, not the rewritten text.</p>{url !== null && <a href={url} className="mt-3 block break-all rounded-lg bg-indigo-50 p-4 text-2xl font-bold text-indigo-800">{url}</a>}</div>
    {view.humanQuestions.length === 0 && <p className="text-slate-600">Questions have not been generated yet.</p>}
    {view.humanQuestions.map((question, index) => <section key={question.id} className="rounded-lg border border-slate-200 p-4"><h4 className="text-lg font-bold">{index + 1}. {question.questionVi}</h4>{view.humanAnswers.filter((answer) => answer.questionId === question.id).map((answer) => <div key={answer.id} className="mt-3 rounded bg-slate-50 p-3"><p><strong>{answer.respondent}</strong>: {answer.answerVi}</p>{view.humanMappings.filter((mapping) => mapping.answerId === answer.id).map((mapping, i) => <p key={i} className="mt-2 text-sm text-indigo-900">Mapped to <strong>{mapping.findingId === null ? "no finding" : view.findings.find((finding) => finding.id === mapping.findingId)?.title ?? mapping.findingId}</strong> — {mapping.why}</p>)}</div>)}</section>)}
    <div className="flex flex-wrap gap-3"><button type="button" disabled={busy || view.status !== "completed" || view.humanAnswers.length === 0} onClick={() => void act("map")} className="rounded-lg bg-indigo-700 px-5 py-3 font-bold text-white disabled:opacity-50">Map answers</button><button type="button" disabled={busy || view.status !== "completed" || version === null} onClick={() => void act("approve")} className="rounded-lg border border-emerald-600 bg-emerald-50 px-5 py-3 font-bold text-emerald-900 disabled:opacity-50">Approve final text{version === null ? "" : ` (v${version})`}</button></div>
    <p className="text-sm text-slate-600">Mapping and approval are available after the run completes.</p>
    {view.approvals.map((approval, index) => <p key={index} className="font-semibold text-emerald-800">v{approval.version} approved by {approval.approvedBy}</p>)}
    {message !== null && <p role="status" className="text-indigo-800">{message}</p>}{error !== null && <p role="alert" className="text-red-800">{error}</p>}
  </div>;
}
