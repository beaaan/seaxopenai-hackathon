import { useMemo, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, CircleX, Loader2, Play } from "lucide-react";
import type { SuiteComparison, Surface } from "@shared/schema";
import { api } from "../api";
import { useRun, useRuns } from "../hooks";
import { finalVersion, type RunModel } from "../model";
import type { RunContext } from "../pages/RunPage";
import { Badge, Button, Card, Section, cx, pct } from "../ui";

const VERDICT = {
  pass: { label: "PASS", tone: "border-emerald-300 bg-emerald-50 text-emerald-900", icon: <CircleCheck size={28} className="text-emerald-600" /> },
  fail: { label: "FAIL", tone: "border-rose-300 bg-rose-50 text-rose-900", icon: <CircleX size={28} className="text-rose-600" /> },
  inconclusive: { label: "INCONCLUSIVE", tone: "border-amber-300 bg-amber-50 text-amber-900", icon: <CircleAlert size={28} className="text-amber-600" /> },
} as const;

export function PolicyCI(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const runs = useRuns(3000);
  const [launched, setLaunched] = useState<string[]>([]);
  const retests = useMemo(() => {
    const ids = new Set([...(runs ?? []).filter((r) => r.runId.startsWith(`${model.runId}-rt`)).map((r) => r.runId), ...launched]);
    return [...ids].sort().reverse();
  }, [runs, launched, model.runId]);

  return (
    <Section id="ci" kicker="Policy CI" title="Re-test any future edit against the same frozen suite">
      <p className="mb-6 max-w-3xl text-stone-600">
        The suite is this run's scenarios and frozen belief codebook. An edit is read by the same personas and judged per finding
        against its own test–retest noise: it <b>fails</b> if any misreading rises beyond noise, and is <b>inconclusive</b> when the
        evidence is too thin to tell.
      </p>
      <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        <Editor model={model} onLaunched={(id) => setLaunched((prev) => [id, ...prev])} />
        <div className="space-y-3">
          {retests.length === 0 ? <Card className="p-6 text-sm text-stone-500">No re-tests yet. Edit the text and run it.</Card> : retests.map((id) => <RetestCard key={id} runId={id} />)}
        </div>
      </div>
    </Section>
  );
}

function Editor(props: { model: RunModel; onLaunched: (runId: string) => void }): ReactNode {
  const { model } = props;
  const base = model.versions.find((v) => v.version === finalVersion(model)) ?? model.versions[0];
  const [surfaces, setSurfaces] = useState<Surface[]>(() => base?.surfaces.map((s) => ({ ...s })) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changed = base ? surfaces.some((s, i) => s.text !== base.surfaces[i]?.text) : false;
  const smokeSize = model.config?.smokeSize ?? 10;
  const run = (smoke: boolean): void => {
    setBusy(true);
    setError(null);
    api.retest(model.runId, surfaces, smoke).then(
      ({ runId }) => {
        setBusy(false);
        props.onLaunched(runId);
      },
      (err: unknown) => {
        setBusy(false);
        setError(err instanceof Error ? err.message : String(err));
      },
    );
  };
  if (!base) return null;
  return (
    <Card className="p-6">
      <div className="text-sm font-semibold text-stone-900">Edit v{base.version}</div>
      <div className="mt-4 space-y-4">
        {surfaces.map((surface, i) => (
          <label key={surface.id} className="block">
            <span className="text-xs font-semibold tracking-wide text-stone-400 uppercase">{surface.label}</span>
            <textarea
              value={surface.text}
              onChange={(e) => setSurfaces((prev) => prev.map((s, j) => (j === i ? { ...s, text: e.target.value } : s)))}
              rows={Math.min(14, Math.max(3, Math.ceil(surface.text.length / 90)))}
              className="mt-1 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-sm leading-relaxed text-stone-900 focus:border-indigo-400 focus:bg-white focus:outline-none"
            />
          </label>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button disabled={!changed || busy} onClick={() => run(true)}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} Run on {smokeSize} scenarios</Button>
        <Button kind="subtle" disabled={!changed || busy} onClick={() => run(false)}>Full suite ({model.scenarios.length})</Button>
        {!changed && <span className="text-sm text-stone-400">Change the text to run a test.</span>}
      </div>
      {error && <div className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>}
    </Card>
  );
}

function RetestCard(props: { runId: string }): ReactNode {
  const { model } = useRun(props.runId);
  if (!model) return <Card className="p-4 text-sm text-stone-500"><Loader2 size={14} className="mr-2 inline animate-spin" />{props.runId}</Card>;
  const c = model.comparison;
  const total = model.config?.smokeSize ?? 0;
  const read = model.readings.filter((r) => r.policyVersion === model.versions.at(-1)?.version).length;
  return (
    <a href={`#/run/${encodeURIComponent(props.runId)}`} className="block">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs text-stone-500">{props.runId}</span>
          {c ? <Verdict verdict={c.verdict} small /> : model.status === "failed" ? <Badge tone="bad">failed</Badge> : <Badge tone="info"><Loader2 size={12} className="animate-spin" /> reading {read}/{total || "…"}</Badge>}
        </div>
        {c && <ul className="mt-2 space-y-0.5 text-sm text-stone-700">{c.reasons.slice(0, 3).map((r, i) => <li key={i}>• {r}</li>)}</ul>}
        {model.error && <div className="mt-2 text-sm text-rose-700">{model.error}</div>}
      </Card>
    </a>
  );
}

function Verdict(props: { verdict: SuiteComparison["verdict"]; small?: boolean }): ReactNode {
  const v = VERDICT[props.verdict];
  if (props.small) return <span className={cx("rounded-full border px-2 py-0.5 text-xs font-bold tracking-wide", v.tone)}>{v.label}</span>;
  return <div className={cx("flex items-center gap-3 rounded-2xl border px-5 py-4", v.tone)}>{v.icon}<span className="text-2xl font-bold tracking-wide">{v.label}</span></div>;
}

/** The page body of a retest run. */
export function RetestResult(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const c = model.comparison;
  const edited = model.versions.at(-1);
  const base = c ? model.versions.find((v) => v.version === c.baseVersion) : model.versions.at(-2);
  const titles = new Map(model.findings.map((f) => [f.id, f.title]));
  const baseTexts = new Set(base?.sentences.map((s) => s.text.trim()) ?? []);
  const editedTexts = new Set(edited?.sentences.map((s) => s.text.trim()) ?? []);
  const removed = base?.sentences.filter((s) => !editedTexts.has(s.text.trim())) ?? [];
  const added = edited?.sentences.filter((s) => !baseTexts.has(s.text.trim())) ?? [];
  const total = model.scenarios.length;
  const read = edited ? model.readings.filter((r) => r.policyVersion === edited.version).length : 0;
  return (
    <section id="overview" className="scroll-mt-28 space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        {c ? <Verdict verdict={c.verdict} /> : model.status === "failed" ? <Badge tone="bad">failed</Badge> : (
          <div className="flex items-center gap-3 rounded-2xl border border-sky-200 bg-sky-50 px-5 py-4 text-sky-900"><Loader2 className="animate-spin" /> Reading the edit: {read}/{total} personas</div>
        )}
        {c?.fidelity && (c.fidelity.passed
          ? <Badge tone="good">same rules as the original (fidelity passed)</Badge>
          : <Badge tone="bad">changes the rule, not just the wording</Badge>)}
        {model.config?.suiteRunId && <a className="text-sm text-indigo-700 underline" href={`#/run/${encodeURIComponent(model.config.suiteRunId)}`}>suite: {model.config.suiteRunId}</a>}
      </div>
      {c && <ul className="space-y-1 text-stone-800">{c.reasons.map((r, i) => <li key={i}>• {r}</li>)}</ul>}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="text-sm font-semibold text-stone-900">The edit</div>
          <div className="mt-3 space-y-2 text-sm">
            {removed.map((s) => <div key={`-${s.id}`} className="rounded-lg bg-rose-50 px-3 py-2 text-stone-700 line-through decoration-rose-300">{s.text}</div>)}
            {added.map((s) => <div key={`+${s.id}`} className="rounded-lg bg-emerald-50 px-3 py-2 text-stone-900">{s.text}</div>)}
            {removed.length === 0 && added.length === 0 && <div className="text-stone-500">No sentence changed.</div>}
          </div>
        </Card>
        {c && (
          <Card className="overflow-x-auto p-6">
            <div className="text-sm font-semibold text-stone-900">Per finding, same {c.after.readings} scenarios</div>
            <table className="mt-3 w-full text-sm">
              <thead><tr className="border-b border-stone-200 text-left text-xs text-stone-500"><th className="py-2 font-medium">Finding</th><th className="text-right font-medium">before</th><th className="text-right font-medium">after</th><th className="text-right font-medium">noise</th></tr></thead>
              <tbody>
                <tr className="border-b border-stone-100">
                  <td className="py-2 text-stone-800">Conflict rate</td>
                  <td className="text-right tabular-nums">{pct(c.before.conflictRate)}</td>
                  <td className="text-right tabular-nums">{pct(c.after.conflictRate)}</td>
                  <td className="text-right text-stone-500 tabular-nums">{c.after.noiseBand === null ? "—" : `±${(c.after.noiseBand * 100).toFixed(0)}`}</td>
                </tr>
                {c.before.findingReproduction.map((row) => {
                  const after = c.after.findingReproduction.find((r) => r.findingId === row.findingId);
                  const delta = after && after.n > 0 && row.n > 0 ? after.rate - row.rate : null;
                  const beyond = delta !== null && row.noiseBand !== null && Math.abs(delta) > row.noiseBand;
                  return (
                    <tr key={row.findingId} className="border-b border-stone-100 last:border-0">
                      <td className="py-2 pr-3 text-stone-800">{titles.get(row.findingId) ?? row.findingId}</td>
                      <td className="text-right tabular-nums">{row.n === 0 ? "—" : pct(row.rate)}</td>
                      <td className={cx("text-right tabular-nums", beyond && delta !== null && (delta < 0 ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"))}>{after && after.n > 0 ? pct(after.rate) : "—"}</td>
                      <td className="text-right text-stone-500 tabular-nums">{row.noiseBand === null ? "n/a" : `±${(row.noiseBand * 100).toFixed(0)}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="mt-3 text-xs text-stone-500">{c.after.noiseBandScenarios ?? 0} test–retest pairs. Green/red only when a change exceeds that finding's noise.</div>
          </Card>
        )}
      </div>
    </section>
  );
}
