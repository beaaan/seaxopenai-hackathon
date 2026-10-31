import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { api, type PolicyDetail } from "../api";
import { useRun } from "../hooks";
import { CLASS_LABEL, STAGES, codebook, finalVersion, hasReference, originalReadings, sharedBeliefs, type RunModel } from "../model";
import { Badge, Stat, cx, pct, pp } from "../ui";
import { TextMap } from "../run/TextMap";
import { Findings } from "../run/Findings";
import { Proof } from "../run/Proof";
import { PolicyCI, RetestResult } from "../run/PolicyCI";
import { Readers } from "../run/Readers";
import { Benchmark } from "../run/Benchmark";
import { Agents } from "../run/Agents";
import { HumanCheckSection } from "../run/HumanCheckSection";

export interface RunContext {
  model: RunModel;
  policy: PolicyDetail | null;
}

const NAV = [
  { id: "overview", label: "Overview" },
  { id: "text", label: "Where it breaks" },
  { id: "findings", label: "Findings" },
  { id: "proof", label: "Rewrite & proof" },
  { id: "ci", label: "Policy CI" },
  { id: "benchmark", label: "Benchmark" },
  { id: "readers", label: "Readers" },
  { id: "agents", label: "Agents" },
  { id: "human", label: "Human check" },
] as const;

export function RunPage(props: { runId: string }): ReactNode {
  const { model, error } = useRun(props.runId);
  const [policy, setPolicy] = useState<PolicyDetail | null>(null);
  const policyId = model?.config?.policyId ?? null;
  useEffect(() => {
    if (policyId === null) return;
    let alive = true;
    api.policy(policyId).then((detail) => alive && setPolicy(detail), () => {});
    return () => {
      alive = false;
    };
  }, [policyId]);

  if (error) return <main className="mx-auto max-w-7xl px-6 py-16"><Badge tone="bad">Could not load run</Badge><p className="mt-3 text-stone-600">{error}</p></main>;
  if (model === null) return <main className="mx-auto flex max-w-7xl items-center gap-2 px-6 py-16 text-stone-500"><Loader2 className="animate-spin" size={18} /> Loading {props.runId}…</main>;

  const ctx: RunContext = { model, policy };
  const isRetest = model.config?.mode === "retest";
  const explore = model.config?.mode === "explore";
  const nav = NAV.filter((item) => {
    if (isRetest) return ["overview", "readers"].includes(item.id);
    if (explore) return ["overview", "text", "readers", "agents"].includes(item.id);
    return true;
  });

  return (
    <main className="pb-32">
      <RunHeader ctx={ctx} />
      <nav className="sticky top-14 z-20 border-b border-stone-200/80 bg-[#f7f6f3]/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-6 py-2">
          {nav.map((item) => (
            <button
              key={item.id}
              onClick={() => document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="rounded-lg px-3 py-1.5 text-sm whitespace-nowrap text-stone-600 hover:bg-stone-200/60 hover:text-stone-900"
            >
              {item.label}
            </button>
          ))}
        </div>
      </nav>
      <div className="mx-auto max-w-7xl space-y-20 px-6 pt-10">
        {isRetest ? <RetestResult ctx={ctx} /> : <Overview ctx={ctx} />}
        {!isRetest && <TextMap ctx={ctx} />}
        {!isRetest && !explore && <Findings ctx={ctx} />}
        {!isRetest && !explore && <Proof ctx={ctx} />}
        {!isRetest && !explore && <PolicyCI ctx={ctx} />}
        {!isRetest && !explore && <Benchmark ctx={ctx} />}
        <Readers ctx={ctx} />
        {!isRetest && <Agents ctx={ctx} />}
        {!isRetest && !explore && <HumanCheckSection ctx={ctx} />}
      </div>
    </main>
  );
}

function RunHeader(props: { ctx: RunContext }): ReactNode {
  const { model, policy } = props.ctx;
  const p = model.provenance;
  const warnings = model.logs.filter((l) => l.level !== "info");
  return (
    <div className="border-b border-stone-200 bg-white">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500">
          <span className="font-mono">{model.runId}</span>
          <span>·</span>
          <span>{model.config?.mode ?? "?"} run</span>
          {model.startedAt && <><span>·</span><span>{new Date(model.startedAt).toLocaleString()}</span></>}
        </div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-stone-900 md:text-4xl">{policy?.package.title ?? model.config?.policyId ?? "Run"}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {model.status === "running" && <Badge tone="info"><Loader2 size={12} className="animate-spin" /> running · {model.events} events</Badge>}
          {model.status === "completed" && <Badge tone="good"><CheckCircle2 size={12} /> completed</Badge>}
          {model.status === "failed" && <Badge tone="bad"><AlertTriangle size={12} /> failed</Badge>}
          {p.decisions && <Badge tone={p.decisions === "real" ? "accent" : "warn"} title="Grades and codings come from the Decisions API (gpt-6-luna)">Decisions API: {p.decisions}</Badge>}
          {p.embeddings !== null && <Badge tone={p.embeddings ? "accent" : "warn"}>embeddings {p.embeddings ? "on" : "off"}</Badge>}
          {p.backends && <Badge title="Bulk calls / agent threads">{p.backends}</Badge>}
          {model.config && <Badge tone={hasReference(model) ? "good" : "warn"}>{hasReference(model) ? "reference facts loaded" : "no reference: conflicts not graded"}</Badge>}
          {model.runId.startsWith("fixture") && <Badge tone="warn">synthetic fixture</Badge>}
        </div>
        {model.error && <div className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{model.error}</div>}
        {warnings.length > 0 && (
          <details className="mt-4 text-sm text-amber-800">
            <summary className="cursor-pointer">{warnings.length} warning{warnings.length > 1 ? "s" : ""}</summary>
            <ul className="mt-2 list-disc pl-5">{warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
          </details>
        )}
      </div>
    </div>
  );
}

function Overview(props: { ctx: RunContext }): ReactNode {
  const { model, policy } = props.ctx;
  const readers = originalReadings(model).length;
  const beliefs = codebook(model);
  const shared = sharedBeliefs(beliefs);
  const notInText = shared.filter((c) => c.sentenceId === null);
  const byClass = useMemo(() => {
    const counts: Record<string, number> = { wording_fix: 0, design_gap: 0, unresolvable: 0 };
    for (const f of model.findings) counts[f.class] = (counts[f.class] ?? 0) + 1;
    return counts;
  }, [model.findings]);
  const first = model.iterations[0] ?? null;
  const last = model.iterations.findLast((it) => it.policyVersion === finalVersion(model)) ?? model.iterations.at(-1) ?? null;
  const reference = hasReference(model);
  const windTunnel = model.score?.systems.find((s) => s.id === "wind-tunnel") ?? null;
  const baselineMean = model.score?.systems.find((s) => s.id === "baseline-mean") ?? null;
  const title = policy?.package.title ?? model.config?.policyId ?? "the policy";

  return (
    <section id="overview" className="scroll-mt-28">
      <p className="max-w-4xl text-2xl leading-snug text-stone-800">
        <b className="font-semibold text-stone-900">{readers} simulated readers</b> read “{title}”.
        {beliefs.length > 0 && <> They formed <b className="font-semibold text-stone-900">{beliefs.length} distinct beliefs</b>, {shared.length} shared by two or more readers{notInText.length > 0 && <>, and <b className="font-semibold text-rose-700">{notInText.length} about rules the text never states</b></>}.</>}
        {model.findings.length > 0 && <> The judge raised <b className="font-semibold text-stone-900">{model.findings.length} findings</b>: {byClass.wording_fix} fixable by wording, {byClass.design_gap} needing a rule change, {byClass.unresolvable} needing information the text does not have.</>}
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Readers" value={readers} hint={`${model.scenarios.length} scenarios · ${model.dimensions.length} dimensions`} />
        <Stat label="Shared beliefs" value={shared.length} hint={`of ${beliefs.length} in the frozen codebook`} />
        <Stat
          label="Findings"
          value={model.findings.length}
          hint={model.findings.length ? `${byClass.wording_fix} ${CLASS_LABEL.wording_fix.toLowerCase()} · ${byClass.design_gap} rule gap · ${byClass.unresolvable} missing info` : "after the codebook is frozen"}
        />
        {windTunnel ? (
          <Stat label="Holdout recall" value={pct(windTunnel.recall)} tone="good" hint={baselineMean ? `single-pass baseline ${pct(baselineMean.recall)}` : undefined} />
        ) : reference && first && last ? (
          <Stat
            label="Conflict rate"
            value={<>{pct(first.conflictRate)} → {pct(last.conflictRate)}</>}
            tone={last.conflictRate < first.conflictRate - (first.noiseBand ?? 0) ? "good" : undefined}
            hint={first.noiseBand !== null ? `noise ±${pp(first.noiseBand).replace("+", "")} on ${first.noiseBandScenarios} re-read pairs` : "noise not measured"}
          />
        ) : (
          <Stat label="Re-read pairs" value={first?.noiseBandScenarios ?? "—"} hint="v0 read twice to measure noise" />
        )}
      </div>

      <ol className="mt-8 flex flex-wrap items-center gap-x-2 gap-y-3 text-sm">
        {STAGES.map((stage, i) => {
          const done = stage.done(model);
          const active = !done && (i === 0 || STAGES[i - 1]!.done(model)) && model.status === "running";
          return (
            <li key={stage.id} className="flex items-center gap-2">
              <span className={cx("flex items-center gap-1.5 rounded-full px-3 py-1", done ? "bg-stone-900 text-white" : active ? "bg-indigo-100 text-indigo-800" : "bg-stone-100 text-stone-400")}>
                {done ? <CheckCircle2 size={14} /> : active ? <Loader2 size={14} className="animate-spin" /> : <Circle size={14} />}
                {stage.label}
              </span>
              {i < STAGES.length - 1 && <span className="h-px w-4 bg-stone-300" />}
            </li>
          );
        })}
      </ol>
      {model.stop && <p className="mt-6 max-w-4xl text-stone-600"><span className="font-medium text-stone-900">Loop stopped:</span> {model.stop.reason}</p>}
    </section>
  );
}
