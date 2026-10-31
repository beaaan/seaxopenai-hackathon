import type { ReactNode } from "react";
import { Bot, FileSearch, Layers, ListChecks, Scale, ScanSearch, Users, Wand2 } from "lucide-react";
import type { RunModel } from "../model";
import usage from "./usage.json";

/** Real token usage from one instrumented run (scripts/usage-summary.ts → docs/usage-probe.json, copied here). */
interface StageUsage {
  stage: string;
  model: string;
  calls: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  costUsd: number;
}
interface UsageProbe {
  runId: string;
  readers: number;
  stages: StageUsage[];
  totalCostUsd: number;
  wallSeconds: number;
}
const PROBE = usage as UsageProbe;

/** Stages whose work grows with the number of readers; the rest run a fixed number of times per test. */
const PER_READER = new Set(["reader", "grader", "coder", "embeddings", "decisions", "resolution"]);

interface Layer {
  name: string;
  icon: ReactNode;
  stages: string[];
  ask: string;
  gives: (m: RunModel) => { value: string; unit: string };
  proof: (m: RunModel) => string | null;
}

const LAYERS: Layer[] = [
  {
    name: "Find who reads it differently",
    icon: <ScanSearch />,
    stages: ["dims"],
    ask: "Which traits change how someone reads this policy?",
    gives: (m) => ({ value: String(m.dimensions.length), unit: "reader traits" }),
    proof: () => null,
  },
  {
    name: "Readers read the text",
    icon: <Users />,
    stages: ["reader"],
    ask: "You are this shopper, a friend told you this, you see this screen. What do you believe now?",
    gives: (m) => ({ value: String(m.readings.reduce((n, r) => n + r.interpretations.length, 0)), unit: "beliefs, in their words" }),
    proof: (m) => {
      const band = m.iterations[0]?.findingReproduction.find((r) => r.noiseBand !== null)?.noiseBand;
      return band === undefined || band === null ? null : `Same reader, read twice: within ±${Math.round(band * 100)} points`;
    },
  },
  {
    name: "Check every belief against the text",
    icon: <ListChecks />,
    stages: ["grader"],
    ask: "Does this belief fit the policy, contradict it, or go beyond it?",
    gives: (m) => ({ value: String(m.grades.length), unit: "checks" }),
    proof: () => null,
  },
  {
    name: "Group the same idea",
    icon: <Layers />,
    stages: ["embeddings", "coder", "decisions"],
    ask: "Is this belief the same idea as that one?",
    gives: (m) => ({ value: `${m.readings.reduce((n, r) => n + r.interpretations.length, 0)} → ${m.findings.length}`, unit: "beliefs into misreadings" }),
    proof: (m) => (m.codings.length ? `${m.codings.length.toLocaleString("en-US")} yes/no matches` : null),
  },
  {
    name: "An agent picks the next readers",
    icon: <Bot />,
    stages: ["reviewer"],
    ask: "Where do beliefs still split? Who should read next?",
    gives: (m) => ({ value: String(m.allocations.length), unit: "decisions" }),
    proof: (m) => {
      const found = m.allocations.at(-1)?.discovery.map((d) => d.newClusters) ?? [];
      return found.length > 1 ? `New beliefs per round: ${found.join(" → ")}` : null;
    },
  },
  {
    name: "Name each misreading and try a fix",
    icon: <Wand2 />,
    stages: ["judge", "repair", "fidelity", "resolution"],
    ask: "What do they get wrong, and can a rewrite fix it without changing a rule?",
    gives: (m) => ({ value: String(m.findings.length), unit: "misreadings, each with a verdict" }),
    proof: (m) => {
      const rule = m.findings.filter((f) => f.class === "design_gap").length;
      return rule ? `${rule} need a rule decision, not new wording` : null;
    },
  },
  {
    name: "Score it against one AI review",
    icon: <Scale />,
    stages: ["baseline", "score"],
    ask: "Which known edge cases did each system find, scored blind?",
    gives: (m) => {
      const cases = new Set(m.score?.matches.map((x) => x.edgeCaseId)).size;
      const hits = (id: string): number | null => {
        const s = m.score?.systems.find((x) => x.id === id);
        return s && cases ? Math.round(s.recall * cases) : null;
      };
      const tunnel = hits("wind-tunnel");
      return tunnel === null ? { value: "–", unit: "" } : { value: `${tunnel}/${cases}`, unit: "known edge cases found" };
    },
    proof: (m) => {
      const cases = new Set(m.score?.matches.map((x) => x.edgeCaseId)).size;
      const s = m.score?.systems.find((x) => x.id === "baseline-mean");
      return s && cases ? `One AI review alone: ${Math.round(s.recall * cases)}/${cases}` : null;
    },
  },
  {
    name: "A persona lives with the rule",
    icon: <FileSearch />,
    stages: ["probe"],
    ask: "Shop as this person for 26 weeks under these assumptions.",
    gives: () => ({ value: "26", unit: "simulated weeks" }),
    proof: () => null,
  },
];

/** Measured cost of the stages, scaled from the probe run to `readers` readers; null when no call of them was measured. */
function stageCost(stages: readonly string[], readers: number): { usd: number; model: string | null } | null {
  const rows = PROBE.stages.filter((s) => stages.includes(s.stage));
  if (rows.length === 0) return null;
  const scale = readers / Math.max(1, PROBE.readers);
  return {
    usd: rows.reduce((sum, s) => sum + s.costUsd * (PER_READER.has(s.stage) ? scale : 1), 0),
    model: [...rows].sort((a, b) => b.costUsd - a.costUsd)[0]?.model ?? null,
  };
}

function usd(x: number): string {
  return x >= 1 ? `$${x.toFixed(2)}` : x >= 0.01 ? `${Math.round(x * 100)}¢` : "<1¢";
}

/** Cost of one call of `stage` on `model`, as measured. */
function perCall(stage: string, model: string): number {
  const row = PROBE.stages.find((s) => s.stage === stage && s.model === model);
  return row && row.calls > 0 ? row.costUsd / row.calls : 0;
}

export function Pipeline(props: { model: RunModel | null; wallSeconds: number | null }): ReactNode {
  const { model, wallSeconds } = props;
  if (!model) return null;
  const readers = model.scenarios.length;
  const costs = LAYERS.map((l) => stageCost(l.stages, readers));
  // Every measured stage counts toward the total, including calls no layer above names.
  const total = stageCost(PROBE.stages.map((s) => s.stage), readers)?.usd ?? 0;
  const max = Math.max(...costs.map((c) => c?.usd ?? 0), 1e-9);
  // An edit test rereads 10 readers three times (original, edit, repeat): 15 probe readers' worth of the per-reader
  // stages, each of which read twice in the probe; plus one fact check of the edit.
  const editTest = (stageCost(["reader", "grader", "coder", "embeddings"], 15)?.usd ?? 0) + perCall("fidelity", "gpt-6.1-sol");
  const review = perCall("baseline", "gpt-6.1-sol");
  return (
    <section className="l-section l-pipeline" id="pipeline" aria-labelledby="pipeline-title">
      <h2 id="pipeline-title" data-rise>Eight AI layers, one question each</h2>
      <ol className="p-layers">
        {LAYERS.map((l, i) => {
          const g = l.gives(model);
          const proof = l.proof(model);
          const c = costs[i] ?? null;
          return (
            <li key={l.name} data-rise>
              <span className="p-icon">{l.icon}</span>
              <div className="p-what">
                <b>{l.name}</b>
                <q>{l.ask}</q>
              </div>
              <div className="p-gives">
                <strong>{g.value}</strong>
                <span>{g.unit}</span>
                {proof && <small>{proof}</small>}
              </div>
              <div className="p-cost">
                <span className="p-bar"><i style={{ width: `${((c?.usd ?? 0) / max) * 100}%` }} /></span>
                <b>{c ? usd(c.usd) : "–"}</b>
                <small>{c?.model ?? "not measured (cached)"}</small>
              </div>
            </li>
          );
        })}
      </ol>
      <h3 className="p-econ-title" data-rise>What it costs</h3>
      <div className="p-econ" data-rise>
        <div><strong>{usd(total)}</strong><span>one full test, {readers} readers{wallSeconds ? `, ${Math.round(wallSeconds / 60)} min` : ""}</span></div>
        <div><strong>{usd(editTest)}</strong><span>to retest one edit on the same 10 readers, about 20 s</span></div>
        <div><strong>{usd(review)}</strong><span>one AI review, which lists problems but can't count who believes them</span></div>
      </div>
      {review > 0 && (
        <p className="p-worth" data-rise>
          A full test costs as much as {Math.round(total / review)} single reviews. It buys what a review can't: how many readers believe each problem, who they are, and whether a fix works. At {usd(editTest)} an edit, every change to the text can be retested before it ships.
        </p>
      )}
      <p className="p-note" data-rise>Token counts measured on a {PROBE.readers}-reader run ({PROBE.runId}) at OpenAI list prices; per-reader stages scaled to {readers} readers.</p>
    </section>
  );
}
