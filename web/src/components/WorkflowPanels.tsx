import { useState, type FormEvent, type ReactNode } from "react";
import type { PolicyVersion, SuiteComparison } from "@shared/schema";
import { approveVersion, mapHumanAnswers, retestRun } from "../api";
import type { RunView } from "../state";
import { pct } from "../ui";

interface CodebookCohort {
  version: number;
  tag: string;
  readingIdsByScenario: Map<string, string>;
}

export function CodebookPanel(props: { view: RunView }): ReactNode {
  const { view } = props;
  const codebookVersion = view.codebookVersion;
  if (codebookVersion === null) return <p className="text-slate-600">The belief codebook has not been frozen yet.</p>;

  const grouped = new Map<string, CodebookCohort>();
  for (const reading of Object.values(view.readings)) {
    const prefix = `r-${reading.scenarioId}-v${reading.policyVersion}`;
    const suffix = reading.id.slice(prefix.length);
    const tag = reading.id.startsWith(prefix) && (suffix === "" || suffix.startsWith("-")) ? suffix.replace(/^-/, "") : `unparsed:${reading.id}`;
    const key = `${reading.policyVersion}:${tag}`;
    let cohort = grouped.get(key);
    if (cohort === undefined) {
      cohort = { version: reading.policyVersion, tag, readingIdsByScenario: new Map() };
      grouped.set(key, cohort);
    }
    cohort.readingIdsByScenario.set(reading.scenarioId, reading.id);
  }
  const cohorts = [...grouped.values()].sort((a, b) => a.version - b.version || a.tag.localeCompare(b.tag));
  const probabilities = new Map<string, Map<string, number>>();
  for (const codings of Object.values(view.codings)) {
    for (const coding of codings) {
      let beliefs = probabilities.get(coding.readingId);
      if (beliefs === undefined) {
        beliefs = new Map();
        probabilities.set(coding.readingId, beliefs);
      }
      beliefs.set(coding.clusterId, coding.probability);
    }
  }

  return (
    <div className="space-y-3" data-testid="codebook-panel">
      <p className="text-slate-600">Fixed v{view.codebookVersion} belief statements · mean P(reading holds belief). Cohorts are separate by policy version and replicate tag. Version deltas use only shared coded scenarios with the same tag; green marks a drop beyond the recorded noise with at least 5 pairs, not a judgement that every belief is wrong.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b-2 border-slate-200">
              <th className="p-3">Belief / Niềm tin</th>
              {cohorts.map((cohort) => <th key={`${cohort.version}:${cohort.tag}`} className="min-w-56 p-3 text-right">v{cohort.version} · {cohort.tag || "primary (no tag)"}<div className="text-sm font-normal text-slate-600">{cohort.readingIdsByScenario.size} persona readings</div></th>)}
            </tr>
          </thead>
          <tbody>{view.codebookClusterIds.map((id) => {
            const cluster = view.clusters[codebookVersion]?.find((belief) => belief.id === id);
            const measurements = cohorts.map((cohort) => {
              const byScenario = new Map<string, number>();
              let sum = 0;
              for (const [scenarioId, readingId] of cohort.readingIdsByScenario) {
                const probability = probabilities.get(readingId)?.get(id);
                if (probability === undefined) continue;
                byScenario.set(scenarioId, probability);
                sum += probability;
              }
              return { cohort, byScenario, mean: byScenario.size === 0 ? null : sum / byScenario.size };
            });
            return (
              <tr key={id} className="border-b border-slate-200 align-top">
                <th className="p-3 font-medium"><div>{cluster?.labelVi ?? id}</div><div className="mt-1 text-sm font-normal text-slate-600">{cluster?.labelEn}</div></th>
                {measurements.map((current, index) => {
                  const previous = measurements.findLast((candidate, candidateIndex) => candidateIndex < index && candidate.cohort.tag === current.cohort.tag && candidate.cohort.version < current.cohort.version);
                  let pairs = 0;
                  let beforeSum = 0;
                  let afterSum = 0;
                  if (previous !== undefined) {
                    for (const [scenarioId, after] of current.byScenario) {
                      const before = previous.byScenario.get(scenarioId);
                      if (before === undefined) continue;
                      pairs += 1;
                      beforeSum += before;
                      afterSum += after;
                    }
                  }
                  const iteration = view.iterations.findLast((item) => item.policyVersion === current.cohort.version) ?? view.iterations.findLast((item) => item.policyVersion === previous?.cohort.version);
                  const noise = iteration?.noiseBand ?? null;
                  const noisePairs = iteration?.noiseBandScenarios ?? null;
                  const drop = pairs === 0 ? 0 : (beforeSum - afterSum) / pairs;
                  const sufficient = pairs >= 5 && noise !== null && noisePairs !== null && noisePairs >= 5;
                  return (
                    <td key={`${current.cohort.version}:${current.cohort.tag}`} className="p-3 text-right">
                      <div className="text-2xl font-bold tabular-nums">{current.mean === null ? "—" : pct(current.mean)}</div>
                      <div className="text-xs text-slate-600">cohort n = {current.byScenario.size}</div>
                      {previous !== undefined && pairs === 0 && <p className="mt-2 text-sm text-slate-600">No shared coded scenarios · paired n = 0</p>}
                      {pairs > 0 && (
                        <div className={`mt-2 rounded p-2 text-sm ${sufficient && drop > noise ? "bg-emerald-50 text-emerald-900" : "bg-slate-50 text-slate-700"}`}>
                          <div>Paired v{previous?.cohort.version} → v{current.cohort.version}: {pct(beforeSum / pairs)} → {pct(afterSum / pairs)}</div>
                          <div className="font-semibold">Δ {drop > 0 ? "−" : drop < 0 ? "+" : ""}{Math.abs(drop * 100).toFixed(1)} pp · paired n = {pairs}</div>
                          <div>{noise === null || noisePairs === null ? "no noise estimate" : `test–retest noise ±${pct(noise)} (paired n=${noisePairs}, v${iteration?.policyVersion})`}</div>
                          {(pairs < 5 || (noisePairs !== null && noisePairs < 5)) && <div className="font-semibold text-amber-900">insufficient pairs</div>}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
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
