import { useState, type ReactNode } from "react";
import type { ThreadItemRecord } from "@shared/schema";
import { wordDiff } from "../diff";
import type { RunView } from "../state";
import { pct } from "../ui";

const TABS = {
  iterations: "Iterations",
  diff: "Diff",
  score: "Baseline vs Wind Tunnel",
  threads: "Threads",
} as const;
type Tab = keyof typeof TABS;

function Iterations(props: { view: RunView }): ReactNode {
  const { iterations, stop } = props.view;
  if (iterations.length === 0) return <p className="text-slate-500">No iterations yet.</p>;
  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="py-1">Version</th>
            <th className="text-right">Readings</th>
            <th className="text-right">Conflict rate</th>
            <th className="text-right">95% CI</th>
            <th className="text-right">Noise band</th>
            <th className="text-right">Open questions</th>
            <th className="text-right">Open wording</th>
            <th className="pl-4">Decision</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {iterations.map((it) => (
            <tr key={it.policyVersion} className="border-t border-slate-100 align-top">
              <td className="py-1 font-semibold">v{it.policyVersion}</td>
              <td className="text-right font-mono">{it.readings}</td>
              <td className="text-right font-mono text-base font-bold">{pct(it.conflictRate)}</td>
              <td className="text-right font-mono">
                {pct(it.ci95.lo)}–{pct(it.ci95.hi)}
              </td>
              <td className="text-right font-mono">{it.noiseBand === null ? "—" : `±${pct(it.noiseBand)}`}</td>
              <td className="text-right font-mono">{pct(it.openQuestionRate)}</td>
              <td className="text-right font-mono">{it.openWordingFindings}</td>
              <td className="pl-4">
                <span className={`rounded px-2 py-0.5 font-semibold ${it.decision === "stop" ? "bg-sky-100 text-sky-800" : "bg-amber-100 text-amber-900"}`}>{it.decision}</span>
              </td>
              <td className="text-slate-600">{it.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {stop !== null && (
        <p className="text-sm">
          <span className="font-semibold">Stopped at v{stop.finalVersion}:</span> {stop.reason}
        </p>
      )}
    </div>
  );
}

function Diff(props: { view: RunView }): ReactNode {
  const { versions, rewrites } = props.view;
  const numbers = Object.keys(versions)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((v) => versions[v]?.parentVersion !== null);
  const [picked, setPicked] = useState<number | null>(null);
  const toVersion = picked !== null && numbers.includes(picked) ? picked : numbers[numbers.length - 1];
  const to = toVersion === undefined ? undefined : versions[toVersion];
  const from = to?.parentVersion === null || to === undefined ? undefined : versions[to.parentVersion];
  if (to === undefined || from === undefined) return <p className="text-slate-500">Only one version so far.</p>;
  const rewrite = rewrites.find((r) => r.toVersion === to.version);
  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {numbers.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setPicked(v)}
            className={`rounded px-3 py-1 text-sm font-semibold ${v === to.version ? "bg-indigo-600 text-white" : "bg-slate-100"}`}
          >
            v{versions[v]?.parentVersion} → v{v}
          </button>
        ))}
      </div>
      {to.surfaces.map((surface) => {
        const before = from.surfaces.find((s) => s.id === surface.id)?.text ?? "";
        return (
          <div key={surface.id}>
            <div className="mb-1 text-xs font-semibold text-slate-500">{surface.label}</div>
            <p className="leading-relaxed whitespace-pre-wrap">
              {wordDiff(before, surface.text).map((part, i) =>
                part.kind === "same" ? (
                  <span key={i}>{part.text}</span>
                ) : part.kind === "del" ? (
                  <del key={i} className="bg-red-100 text-red-800">
                    {part.text}
                  </del>
                ) : (
                  <ins key={i} className="bg-emerald-100 text-emerald-900 no-underline">
                    {part.text}
                  </ins>
                ),
              )}
            </p>
          </div>
        );
      })}
      {rewrite !== undefined && (
        <div className="text-sm text-slate-600">
          {rewrite.edits.length} edits ·{" "}
          {rewrite.edits.map((e) => `${e.sentenceIds.join("+") || "insert"} (${e.findingIds.join(", ")})`).join(" · ")} · fidelity{" "}
          {rewrite.fidelity.passed ? "passed" : "failed"}
        </div>
      )}
    </div>
  );
}

function ScoreTab(props: { view: RunView }): ReactNode {
  const { score, baselines } = props.view;
  return (
    <div className="grid grid-cols-2 gap-4">
      <div>
        {score === null ? (
          <p className="text-slate-500">No score yet.</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <tbody>
                {score.systems.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="py-1 font-semibold">{s.label}</td>
                    <td className="w-1/2">
                      <div className="h-4 rounded bg-slate-100">
                        <div className={`h-4 rounded ${s.id === "wind-tunnel" ? "bg-indigo-600" : "bg-slate-400"}`} style={{ width: pct(s.recall) }} />
                      </div>
                    </td>
                    <td className="pl-2 text-right font-mono font-bold">{pct(s.recall)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <MatchMatrix view={props.view} />
          </>
        )}
      </div>
      <div className="space-y-2 text-sm">
        {baselines.map((b) => (
          <div key={b.id}>
            <div className="font-semibold">
              {b.id} <span className="font-normal text-slate-500">({b.model}, {b.effort})</span>
            </div>
            <ul className="list-disc pl-5">
              {b.issues.map((i) => (
                <li key={i.id}>
                  <span className="font-mono text-xs text-slate-400">{i.id}</span> “{i.sentenceQuote}” — {i.issue}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchMatrix(props: { view: RunView }): ReactNode {
  const score = props.view.score;
  if (score === null || score.matches.length === 0) return null;
  const edgeCases = [...new Set(score.matches.map((m) => m.edgeCaseId))];
  const systems = [...new Set(score.matches.map((m) => m.systemId))];
  return (
    <table className="mt-3 w-full text-sm">
      <thead>
        <tr className="text-left text-slate-500">
          <th>Edge case</th>
          {systems.map((s) => (
            <th key={s}>{s}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {edgeCases.map((ec) => (
          <tr key={ec} className="border-t border-slate-100">
            <td className="py-1 font-mono">{ec}</td>
            {systems.map((s) => {
              const m = score.matches.find((x) => x.edgeCaseId === ec && x.systemId === s);
              return (
                <td key={s} title={m?.why} className={m?.matched === true ? "text-emerald-700" : "text-slate-400"}>
                  {m?.matched === true ? `✔ ${m.itemId ?? ""}` : "✖"}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Threads(props: { view: RunView }): ReactNode {
  const { threadItems, humanQuestions, humanAnswers } = props.view;
  const byThread = new Map<string, ThreadItemRecord[]>();
  for (const item of threadItems) byThread.set(item.threadId, [...(byThread.get(item.threadId) ?? []), item]);
  if (byThread.size === 0 && humanQuestions.length === 0) return <p className="text-slate-500">No thread items yet.</p>;
  return (
    <div className="space-y-3">
      {[...byThread].map(([threadId, items]) => (
        <div key={threadId} className="rounded border border-slate-200 p-2">
          <div className="mb-1 font-mono text-sm font-semibold">
            {threadId} <span className="font-normal text-slate-500">· {items[0]?.role} · {items[0]?.backend}</span>
          </div>
          <ul className="space-y-1">
            {items.map((item, i) => (
              <li key={i} className="text-sm">
                <details>
                  <summary className="cursor-pointer">
                    <span className="rounded bg-slate-100 px-1 font-mono text-xs">{item.itemType}</span> {item.label}
                  </summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2 text-xs">{JSON.stringify(item.item, null, 2)}</pre>
                </details>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {humanQuestions.map((q) => (
        <div key={q.id} className="rounded border border-orange-200 p-2 text-sm">
          <div className="font-semibold">❓ {q.questionVi}</div>
          {humanAnswers
            .filter((a) => a.questionId === q.id)
            .map((a) => (
              <div key={a.id}>
                🙋 {a.respondent}: {a.answerVi}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}

export function BottomTabs(props: { view: RunView }): ReactNode {
  const [tab, setTab] = useState<Tab>("iterations");
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
      <div className="flex gap-1 border-b border-slate-200 px-2 pt-2">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-t px-4 py-1.5 text-sm font-semibold ${t === tab ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
          >
            {TABS[t]}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === "iterations" && <Iterations view={props.view} />}
        {tab === "diff" && <Diff view={props.view} />}
        {tab === "score" && <ScoreTab view={props.view} />}
        {tab === "threads" && <Threads view={props.view} />}
      </div>
    </section>
  );
}
