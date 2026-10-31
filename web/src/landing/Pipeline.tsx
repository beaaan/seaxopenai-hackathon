import type { ReactNode } from "react";
import { Bot, FileSearch, Layers, ListChecks, Scale, ScanSearch, Users, Wand2 } from "lucide-react";
import { codebook, originalReadings, type RunModel } from "../model";
import { stageCost, usd } from "./costs";

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

export function Pipeline(props: { model: RunModel | null }): ReactNode {
  const { model } = props;
  if (!model) return null;
  const costs = LAYERS.map((l) => stageCost(l.stages, model));
  const max = Math.max(...costs.map((c) => c?.usd ?? 0), 1e-9);
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
    </section>
  );
}
