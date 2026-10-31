import type { ReactNode } from "react";
import { Bot, FileSearch, Layers, ListChecks, Scale, ScanSearch, Users, Wand2 } from "lucide-react";
import { codebook, originalReadings, type RunModel } from "../model";
import usage from "./usage.json";
import { CountUp } from "./Stakes";

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
const PER_READER = new Set(["reader", "grader", "coder", "embeddings", "decisions"]);

function firstBeliefs(m: RunModel): number {
  return originalReadings(m).reduce((n, r) => n + r.interpretations.length, 0);
}

function codebookSize(m: RunModel): number {
  return codebook(m).length;
}

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
    gives: (m) => ({ value: String(firstBeliefs(m)), unit: "beliefs, in their own words" }),
    proof: (m) => {
      const band = m.iterations[0]?.findingReproduction.find((r) => r.noiseBand !== null)?.noiseBand;
      return band === undefined || band === null ? null : `Every reader reads twice, so the noise is measured: ±${Math.round(band * 100)} points`;
    },
  },
  {
    name: "Check every belief against the text",
    icon: <ListChecks />,
    stages: ["grader"],
    ask: "Does this belief fit the policy, contradict it, or go beyond it?",
    gives: (m) => ({ value: String(m.grades.length), unit: "checks, repeat reads included" }),
    proof: () => null,
  },
  {
    name: "Group the same idea",
    icon: <Layers />,
    stages: ["embeddings", "coder", "decisions"],
    ask: "Is this belief the same idea as that one?",
    gives: (m) => ({ value: `${firstBeliefs(m)} → ${codebookSize(m)} → ${m.findings.length}`, unit: "beliefs → groups → misreadings" }),
    proof: (m) => (m.codings.length ? `${m.codings.length.toLocaleString("en-US")} belief-to-group probability judgments` : null),
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

/**
 * Estimated cost of the stages for run `m`, from the measured probe: per-reader stages scale with the reader count,
 * single AI reviews with how many `m` ran on each model, everything else as measured. Null when nothing was measured.
 */
function stageCost(stages: readonly string[], m: RunModel): { usd: number; model: string | null } | null {
  const rows = PROBE.stages.filter((s) => stages.includes(s.stage));
  if (rows.length === 0) return null;
  const scale = (s: StageUsage): number => {
    if (PER_READER.has(s.stage)) return m.scenarios.length / Math.max(1, PROBE.readers);
    if (s.stage === "baseline") return m.baselines.filter((b) => b.model === s.model).length / Math.max(1, s.calls);
    return 1;
  };
  return {
    usd: rows.reduce((sum, s) => sum + s.costUsd * scale(s), 0),
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

/** One more reading in the probe: reading it, grading it, coding it against the frozen groups (Decisions API). */
function perReading(): number {
  const readings = PROBE.stages.find((s) => s.stage === "reader")?.calls ?? 0;
  const rows = PROBE.stages.filter((s) => s.stage === "reader" || s.stage === "grader" || (s.stage === "coder" && s.model === "gpt-6-luna"));
  return readings > 0 ? rows.reduce((sum, s) => sum + s.costUsd, 0) / readings : 0;
}

export function Pipeline(props: { model: RunModel | null; wallSeconds: number | null }): ReactNode {
  const { model, wallSeconds } = props;
  if (!model) return null;
  const readers = model.scenarios.length;
  const costs = LAYERS.map((l) => stageCost(l.stages, model));
  // Every measured stage counts toward the total, including calls no layer above names.
  const total = stageCost(PROBE.stages.map((s) => s.stage), model)?.usd ?? 0;
  const max = Math.max(...costs.map((c) => c?.usd ?? 0), 1e-9);
  // An edit test reuses the suite's earlier readings: one fresh reading per reader of the edited text, graded and
  // coded against the frozen groups, plus one fact check of the edit.
  const editTest = perReading() * 10 + perCall("fidelity", "gpt-6.1-sol");
  const review = perCall("baseline", "gpt-6.1-sol");
  return (
    <section className="l-section l-pipeline" id="pipeline" aria-labelledby="pipeline-title" data-chapter="Pipeline">
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
        <div><strong><CountUp fact={{ value: total, decimals: 2, prefix: "$" }} /></strong><span>the whole run: {readers} readers{wallSeconds ? `, ${Math.round(wallSeconds / 60)} min` : ""}</span></div>
        <div><strong>{usd(editTest)}</strong><span>to retest an edit on 10 readers, in 17 seconds</span></div>
        <div><strong>{usd(review)}</strong><span>one AI review, which lists problems but can't count who believes them</span></div>
      </div>
      <h3 className="p-econ-title" data-rise>What the alternatives cost</h3>
      <div className="p-econ versus" data-rise>
        <div>
          <strong><CountUp fact={{ value: 4000, prefix: "$" }} /></strong>
          <span>to pay 50 people for a one-hour interview, at $80 an hour</span>
          <a href="https://www.userinterviews.com/blog/research-incentives-report" target="_blank" rel="noreferrer">User Interviews incentive report, updated 2025</a>
        </div>
        <div>
          <strong><CountUp fact={{ value: 8.01, decimals: 2, prefix: "$" }} /></strong>
          <span>for one live support contact{total > 0 && total < 8.01 ? `, as much as ${Math.floor(8.01 / total)} full test runs` : ""}</span>
          <a href="https://emt.gartnerweb.com/ngw/globalassets/en/sales-service/documents/trends/delivering-on-the-digital-promise-ebook.pdf" target="_blank" rel="noreferrer">Gartner, 2019</a>
        </div>
      </div>
      <p className="p-worth" data-rise>
        For a few dollars, every version of the text is tested before it ships: how many readers believe each problem, who they are, and whether the fix works.
      </p>
      <p className="p-note" data-rise>
        Estimated from token counts measured on a {PROBE.readers}-reader run ({PROBE.runId}) at OpenAI list prices, scaled to {readers} readers.
      </p>
    </section>
  );
}
