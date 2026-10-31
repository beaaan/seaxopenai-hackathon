import { useState, type ReactNode } from "react";
import { CircleCheck, CircleDashed, FlaskConical, Loader2 } from "lucide-react";
import { CLASS_LABEL, STAGES, codebook, distinctReaders, finalVersion, hasReference, originalReadings, sharedBeliefs } from "../model";
import type { RunContext } from "../pages/RunPage";
import { Kpis, Panel, TitleRow, band, cx, hostOf, pct, type KpiItem } from "../ui";
import { BeliefDetail, TextMap, cohortSize, useHeat } from "./TextMap";

export function Overview(props: { ctx: RunContext }): ReactNode {
  const { model, policy } = props.ctx;
  const { hottest } = useHeat(props.ctx);
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked ?? hottest;
  const total = cohortSize(props.ctx);
  const beliefs = codebook(model);
  const shared = sharedBeliefs(beliefs);
  const notInText = shared.filter((c) => c.sentenceId === null).length;
  const reference = hasReference(model);
  const explore = model.config?.mode === "explore";
  const first = model.iterations[0] ?? null;
  const last = model.iterations.findLast((it) => it.policyVersion === finalVersion(model)) ?? null;
  const count = (k: keyof typeof CLASS_LABEL): number => model.findings.filter((f) => f.class === k).length;

  // The one finding: the misreading held by the most readers, with its count and its sentence.
  const scenarioOf = new Map(model.readings.map((r) => [r.id, r.scenarioId]));
  const topFinding = [...model.findings]
    .map((f) => ({ f, readers: new Set(f.evidence.readingIds.map((id) => scenarioOf.get(id) ?? id)).size }))
    .sort((a, b) => b.readers - a.readers)[0];
  const topBelief = shared[0];
  let finding: ReactNode = model.status === "running" ? "Readers are still reading; misreadings appear on the text as they finish." : "No misreading was shared by two or more readers.";
  if (topFinding && topFinding.readers > 0) {
    finding = <>Most held: <b style={{ fontWeight: 500 }}>{topFinding.f.title}</b> ({topFinding.readers} of {total} readers){topFinding.f.sentenceIds.length ? <>, traced to <span className="id">{topFinding.f.sentenceIds.join(", ")}</span></> : ", about a rule the text never states"}.</>;
  } else if (topBelief) {
    finding = <>{distinctReaders(topBelief)} of {total} readers believe: <b style={{ fontWeight: 500 }}>{topBelief.labelEn}</b>{topBelief.sentenceId ? <>, at <span className="id">{topBelief.sentenceId}</span></> : ", which the text never states"}.</>;
  }

  const skim = model.scenarios.filter((s) => s.exposure.attention === "skim").length;
  const rumour = model.scenarios.filter((s) => s.exposure.folkVersionId !== null).length;
  const windTunnel = model.score?.systems.find((s) => s.id === "wind-tunnel") ?? null;
  const baselineMean = model.score?.systems.find((s) => s.id === "baseline-mean") ?? null;
  const kpis: KpiItem[] = [
    { label: "Readers", value: total, delta: model.scenarios.length ? `${skim} skimmed · ${rumour} had heard a rumour` : "sampling" },
    { label: "Shared misreadings", value: shared.length, delta: `of ${beliefs.length} beliefs · ${notInText} about rules not in the text` },
  ];
  if (!explore) kpis.push({ label: "Findings", value: model.findings.length, delta: model.findings.length ? `${count("wording_fix")} wording · ${count("design_gap")} rule gap · ${count("unresolvable")} missing info` : "after the codebook is frozen" });
  if (windTunnel) kpis.push({ label: "Holdout recall", value: pct(windTunnel.recall), delta: baselineMean ? `single careful model: ${pct(baselineMean.recall)}` : undefined });
  else if (reference && first && last) kpis.push({ label: "Conflict rate", value: <>{pct(first.conflictRate)} → {pct(last.conflictRate)}</>, delta: first.noiseBand !== null ? `v0 to v${last.policyVersion} · noise ${band(first.noiseBand)}` : `v0 to v${last.policyVersion}` });
  else if (!explore) kpis.push({ label: "Re-read pairs", value: first?.noiseBandScenarios ?? <span className="dash">–</span>, delta: "v0 read twice to measure noise" });

  return (
    <>
      <TitleRow
        title={policy?.package.title ?? model.config?.policyId ?? model.runId}
        sub={finding}
        meta={<>
          <span className="id">{model.runId}</span>
          <span>{model.config?.mode === "explore" ? "Exploration" : "Full run"}{model.startedAt ? ` · ${new Date(model.startedAt).toLocaleString()}` : ""}</span>
          {model.runId.startsWith("fixture") && <span>Synthetic fixture</span>}
        </>}
        actions={!explore && model.versions.length > 0 ? <a className="btn primary" href={`#/run/${encodeURIComponent(model.runId)}/ci`}><FlaskConical /> Test an edit</a> : undefined}
      />
      {model.config && !reference && (
        <div className="notice">No reference facts are loaded for this policy, so readings are not graded as conflicts. The signal here is how many readers share each misreading.</div>
      )}
      <Kpis items={kpis} />
      <div className="grid">
        <div className="c8"><TextMap ctx={props.ctx} selected={selected} onSelect={(id) => {
          setPicked(id);
          // Below 1100px the detail stacks under the text: bring it into view.
          if (window.matchMedia("(max-width: 1100px)").matches) requestAnimationFrame(() => document.getElementById("belief-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
        }} /></div>
        <div className="c4" id="belief-detail"><BeliefDetail ctx={props.ctx} selected={selected} /></div>
      </div>
      <div className="grid">
        <div className="c7"><Rumours ctx={props.ctx} /></div>
        <div className="c5"><Progress ctx={props.ctx} /></div>
      </div>
    </>
  );
}

const RUMOUR_ROWS = 4;

function Rumours(props: { ctx: RunContext }): ReactNode {
  const { model, policy } = props.ctx;
  const [all, setAll] = useState(false);
  const exposed = (id: string): number => model.scenarios.filter((s) => s.exposure.folkVersionId === id).length;
  const folk = [...(policy?.folk.versions ?? [])].sort((a, b) => exposed(b.id) - exposed(a.id));
  const shown = all ? folk : folk.slice(0, RUMOUR_ROWS);
  return (
    <Panel title="What people hear instead" meta={`${folk.length} versions found online`} lede="Circulating versions of the rule. None is in the official text; some readers were told one before reading.">
      {folk.length === 0 ? <p className="muted">No circulating versions were collected for this policy.</p> : (
        <table>
          <thead><tr><th>Version</th><th className="n">Readers told</th></tr></thead>
          <tbody>
            {shown.map((f) => {
              const n = exposed(f.id);
              return (
                <tr key={f.id}>
                  <td>“{f.textVi}”<span className="sub">{f.claimEn} · {hostOf(f.source)}{f.date ? `, ${f.date}` : ""}</span></td>
                  <td className="n">{n === 0 ? <span className="dash">0</span> : n}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {folk.length > RUMOUR_ROWS && <button className="btn ghost" style={{ marginTop: 8, paddingLeft: 0 }} onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${folk.length}`}</button>}
    </Panel>
  );
}

function Progress(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const read = originalReadings(model).length;
  return (
    <Panel title="Run" meta={model.status === "running" ? `${read} of ${model.scenarios.length || "…"} read` : model.status}>
      <ol className="stages">
        {STAGES.map((stage, i) => {
          const done = stage.done(model);
          const now = !done && model.status === "running" && (i === 0 || STAGES[i - 1]!.done(model));
          return (
            <li key={stage.id} className={cx("stage", done && "done", now && "now")}>
              {done ? <CircleCheck style={{ color: "var(--accent)" }} /> : now ? <Loader2 className="spin" /> : <CircleDashed style={{ color: "var(--faint)" }} />}
              <span>{stage.label}</span>
            </li>
          );
        })}
      </ol>
      {model.stop && <p style={{ marginTop: 12 }}><span className="muted">Loop stopped: </span>{model.stop.reason}</p>}
      {model.logs.filter((l) => l.level !== "info").length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary className="small muted" style={{ cursor: "pointer" }}>{model.logs.filter((l) => l.level !== "info").length} warnings</summary>
          <ul className="small" style={{ marginTop: 6, display: "grid", gap: 4 }}>{model.logs.filter((l) => l.level !== "info").map((l, i) => <li key={i}>{l.message}</li>)}</ul>
        </details>
      )}
    </Panel>
  );
}
