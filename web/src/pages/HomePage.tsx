import type { ReactNode } from "react";
import { ArrowRight, FlaskConical, Loader2 } from "lucide-react";
import type { RunSummary } from "@shared/events";
import { useRuns } from "../hooks";
import { Badge, Card, Empty, type Tone } from "../ui";

const STATUS_TONE: Record<RunSummary["status"], Tone> = { running: "info", completed: "good", failed: "bad", unknown: "neutral" };

function kind(run: RunSummary): "retest" | "dev" | "fixture" | "run" {
  if (/-rt\d*$/.test(run.runId) || run.runId.includes("-rt")) return "retest";
  if (run.runId.startsWith("fixture")) return "fixture";
  if (run.runId.startsWith("dev-")) return "dev";
  return "run";
}

export function HomePage(): ReactNode {
  const runs = useRuns();
  const sorted = [...(runs ?? [])].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  const main = sorted.filter((r) => kind(r) === "run");
  const other = sorted.filter((r) => kind(r) !== "run");
  return (
    <main className="mx-auto max-w-7xl px-6 pb-24">
      <div className="grid gap-10 py-14 md:grid-cols-[1.4fr_1fr] md:items-end">
        <div>
          <h1 className="text-5xl leading-[1.05] font-semibold tracking-tight text-stone-900">
            Find how people will misread a policy <span className="text-indigo-600">before they do.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-stone-600">
            Simulated Vietnamese readers with different situations, payment habits and prior rumours read the exact text.
            Their beliefs are frozen into a codebook, every misreading is traced to a sentence, wording fixes are re-read and
            measured against test–retest noise, and every later edit is re-tested on the same suite.
          </p>
        </div>
        <Card className="p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-900"><FlaskConical size={16} /> Test your own text</div>
          <p className="mt-2 text-sm text-stone-600">Paste a Vietnamese policy, notice or help article and watch readers misread it live.</p>
          <a href="#/new" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white hover:bg-stone-700">
            New wind tunnel <ArrowRight size={16} />
          </a>
        </Card>
      </div>

      <h2 className="mb-3 text-sm font-semibold tracking-[0.14em] text-stone-500 uppercase">Runs</h2>
      {runs === null ? (
        <div className="flex items-center gap-2 text-stone-500"><Loader2 className="animate-spin" size={16} /> Loading runs…</div>
      ) : main.length === 0 && other.length === 0 ? (
        <Empty>No runs yet. Start one with <code>npm run pwt -- run cod</code> or test a new policy.</Empty>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {main.map((run) => <RunCard key={run.runId} run={run} />)}
        </div>
      )}
      {other.length > 0 && (
        <>
          <h2 className="mt-10 mb-3 text-sm font-semibold tracking-[0.14em] text-stone-500 uppercase">Re-tests, fixtures and development runs</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {other.map((run) => <RunCard key={run.runId} run={run} compact />)}
          </div>
        </>
      )}
    </main>
  );
}

function RunCard(props: { run: RunSummary; compact?: boolean }): ReactNode {
  const { run } = props;
  const k = kind(run);
  return (
    <a href={`#/run/${encodeURIComponent(run.runId)}`} className="group block">
      <Card className={props.compact ? "p-3" : "p-5"}>
        <div className="flex items-center justify-between gap-2">
          <div className="truncate font-mono text-sm text-stone-900">{run.runId}</div>
          <Badge tone={STATUS_TONE[run.status]}>{run.status === "running" && <Loader2 size={11} className="animate-spin" />}{run.status}</Badge>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-stone-500">
          <span>{run.policyId ?? "?"}</span>
          <span>·</span>
          <span>{run.events} events</span>
          {k !== "run" && <><span>·</span><span>{k}</span></>}
        </div>
        {!props.compact && run.startedAt && <div className="mt-3 text-xs text-stone-400">{new Date(run.startedAt).toLocaleString()}</div>}
      </Card>
    </a>
  );
}
