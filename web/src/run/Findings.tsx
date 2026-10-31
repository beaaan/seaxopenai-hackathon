import { useMemo, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import type { Finding } from "@shared/schema";
import { beyondNoise } from "@shared/noise";
import { CLASS_LABEL, finalVersion } from "../model";
import type { RunContext } from "../pages/RunPage";
import { Empty, Panel, Pill, TitleRow, Track, band, pct, pp, type Tone } from "../ui";
import { cohortSize } from "./TextMap";

export const CLASS_TONE: Record<Finding["class"], Tone> = { wording_fix: "accent", design_gap: "warn", unresolvable: "neutral" };
const ORDER: Record<Finding["class"], number> = { wording_fix: 0, design_gap: 1, unresolvable: 2 };
type Filter = Finding["class"] | "all";

export function Findings(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const total = cohortSize(props.ctx);
  const first = model.iterations[0] ?? null;
  const last = model.iterations.findLast((it) => it.policyVersion === finalVersion(model) && it !== first) ?? null;
  const scenarioOf = useMemo(() => new Map(model.readings.map((r) => [r.id, r.scenarioId])), [model.readings]);
  const readersOf = (f: Finding): number => new Set(f.evidence.readingIds.map((id) => scenarioOf.get(id) ?? id)).size;
  const sorted = [...model.findings].sort((a, b) => ORDER[a.class] - ORDER[b.class] || readersOf(b) - readersOf(a));
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<string | null>(null);
  const shown = sorted.filter((f) => filter === "all" || f.class === filter);
  const selected = shown.find((f) => f.id === picked) ?? shown[0] ?? null;
  const count = (k: Finding["class"]): number => model.findings.filter((f) => f.class === k).length;
  const sentences = new Map(model.versions.find((v) => v.version === 0)?.sentences.map((s) => [s.id, s.text]) ?? []);
  const humans = new Map<string, number>();
  for (const m of model.mappings) if (m.findingId) humans.set(m.findingId, (humans.get(m.findingId) ?? 0) + 1);

  return (
    <>
      <TitleRow
        title="Findings"
        sub={model.findings.length === 0 ? "Findings are written once the belief codebook is frozen." : <>{count("wording_fix")} can be fixed by wording, {count("design_gap")} need a rule change, {count("unresolvable")} need information the text does not have.</>}
        meta={<span>Each finding is classified by attempting a repair: a rewrite that adds no new fact, passes the fidelity check and removes the misreading on re-read is a wording fix.</span>}
      />
      {model.findings.length === 0 ? <Empty>No findings yet.</Empty> : (
        <>
          <div className="segmented" role="group" aria-label="Kind" style={{ marginBottom: 16 }}>
            {(["all", "wording_fix", "design_gap", "unresolvable"] as const).map((k) => (
              <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {k === "all" ? "All" : CLASS_LABEL[k]}<span className="num">{k === "all" ? model.findings.length : count(k)}</span>
              </button>
            ))}
          </div>
          <div className="grid">
            <div className="c7">
              <Panel flush>
                {shown.length === 0 ? <div style={{ padding: 20 }}><Empty>No finding of this kind.</Empty></div> : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Misreading</th><th>Kind</th><th className="n">Readers</th><th className="n hide-phone">Persists on re-read</th></tr></thead>
                      <tbody>
                        {shown.map((f) => {
                          const before = first?.findingReproduction.find((r) => r.findingId === f.id) ?? null;
                          const k = readersOf(f);
                          return (
                            <tr key={f.id} className="pick" aria-selected={selected?.id === f.id} onClick={() => {
                              setPicked(f.id);
                              // Below 1100px the detail stacks under the list: bring it into view.
                              if (window.matchMedia("(max-width: 1100px)").matches) requestAnimationFrame(() => document.getElementById("finding-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
                            }}>
                              <td>{f.title}<span className="sub"><span className="id">{f.sentenceIds.length ? f.sentenceIds.join(", ") : "not in text"}</span></span></td>
                              <td><Pill tone={CLASS_TONE[f.class]}>{CLASS_LABEL[f.class]}</Pill></td>
                              <td className="n" style={{ width: 150 }}>
                                <div style={{ display: "grid", gridTemplateColumns: "1fr 44px", gap: 8, alignItems: "center", paddingTop: 4 }}>
                                  <Track value={total ? k / total : 0} label={`${k} of ${total}`} />
                                  <span>{k}<span className="muted">/{total}</span></span>
                                </div>
                              </td>
                              <td className="n hide-phone">{before && before.n > 0 ? <>{pct(before.rate)}<span className="sub">{before.noiseBand === null ? "noise not measured" : band(before.noiseBand)}</span></> : <span className="dash">–</span>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>
            <div className="c5" id="finding-detail">{selected && <FindingDetail ctx={props.ctx} finding={selected} sentences={sentences} humans={humans.get(selected.id) ?? 0} lastVersion={last?.policyVersion ?? null} />}</div>
          </div>
        </>
      )}
    </>
  );
}

function FindingDetail(props: { ctx: RunContext; finding: Finding; sentences: Map<string, string>; humans: number; lastVersion: number | null }): ReactNode {
  const { model } = props.ctx;
  const f = props.finding;
  const first = model.iterations[0] ?? null;
  const last = props.lastVersion === null ? null : model.iterations.findLast((it) => it.policyVersion === props.lastVersion) ?? null;
  const before = first?.findingReproduction.find((r) => r.findingId === f.id) ?? null;
  const after = last?.findingReproduction.find((r) => r.findingId === f.id) ?? null;
  const repair = f.repair;
  const provisional = f.classRationale.startsWith("Provisional");
  return (
    <Panel className="sticky" title={f.title} meta={<span className="id">{f.id}</span>}>
      <div className="pills">
        <Pill tone={CLASS_TONE[f.class]}>{CLASS_LABEL[f.class]}</Pill>
        {provisional && <Pill title={f.classRationale}>Provisional</Pill>}
        {f.conflictsReference && <Pill tone="neg">Contradicts the reference</Pill>}
        {props.humans > 0 && <Pill tone="accent">{props.humans} real {props.humans === 1 ? "person" : "people"} read it this way</Pill>}
      </div>
      <p style={{ marginTop: 12 }}>{f.readingSummary}</p>
      {f.plausibility && <p className="muted" style={{ marginTop: 8 }}>Why a real reader would: {f.plausibility}</p>}
      <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
        {f.sentenceIds.length > 0
          ? f.sentenceIds.map((id) => <p key={id} className="cite"><span className="id" style={{ marginRight: 8 }}>{id}</span>{props.sentences.get(id) ?? ""}</p>)
          : <p className="empty" style={{ minHeight: 0, placeItems: "start" }}>About a rule the text never states.</p>}
      </div>

      {before && before.n > 0 && (
        <div style={{ marginTop: 18 }}>
          <h3>Persists when the same readers read again</h3>
          <Repro label="Original" rate={before.rate} n={before.n} noise={before.noiseBand} />
          {after && after.n > 0 && <Repro label={`v${props.lastVersion}`} rate={after.rate} n={after.n} noise={null} compare={before} />}
        </div>
      )}

      {repair && (repair.rewriteVi || repair.fidelity.requiresNewFact) && (
        <div style={{ marginTop: 18 }}>
          <h3>Repair attempt</h3>
          {repair.rewriteVi && (
            <div className="diff" style={{ marginTop: 8 }}>
              <div className="before"><span className="label">Before</span>{repair.targetSentenceIds.map((id) => props.sentences.get(id)).filter(Boolean).join(" ") || "(new sentence)"}</div>
              <div className="after"><span className="label">Attempted</span>{repair.rewriteVi}</div>
            </div>
          )}
          {repair.rewriteVi && (
            <ul className="rows" style={{ marginTop: 8 }}>
              <li className="row small">{repair.fidelity.passed ? <Check size={14} className="good" /> : <X size={14} className="bad" />} Fidelity {repair.fidelity.passed ? "passed: same rules as the original" : "failed"}</li>
              {repair.fidelity.facts.filter((fact) => !fact.entailed).map((fact) => <li key={fact.factId} className="row small"><X size={14} className="bad" /> Loses fact <span className="id">{fact.factId}</span>: {fact.why}</li>)}
              {repair.fidelity.newCommitments.map((c, i) => <li key={i} className="row small"><X size={14} className="bad" /> Adds a commitment: {c}</li>)}
            </ul>
          )}
          {repair.fidelity.requiresNewFact && (
            <div className="notice" style={{ marginTop: 10, marginBottom: 0 }}>
              {repair.fidelity.requiresNewFact.kind === "changes_rule" ? "Needs a rule change: " : "Needs information the text does not have: "}{repair.fidelity.requiresNewFact.text}
            </div>
          )}
        </div>
      )}
      <p className="small muted" style={{ marginTop: 16 }}>{f.classRationale}</p>
    </Panel>
  );
}

function Repro(props: { label: string; rate: number; n: number; noise: number | null; compare?: { rate: number; noiseBand: number | null } }): ReactNode {
  const delta = props.compare ? props.rate - props.compare.rate : null;
  const noise = props.compare ? props.compare.noiseBand : props.noise;
  const beyond = delta !== null && noise !== null && beyondNoise(delta, noise);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "64px 1fr 120px", gap: 12, alignItems: "center", marginTop: 10 }}>
      <span className="muted">{props.label}</span>
      <Track value={props.rate} noise={props.compare ? null : props.noise} tick={props.compare?.rate ?? null} />
      <span className="num" style={{ textAlign: "right" }}>
        {pct(props.rate)} <span className="muted small">n={props.n}</span>
        {delta !== null && <span className={beyond ? (delta < 0 ? "good" : "bad") : "muted"} style={{ display: "block" }} >{pp(delta)}{beyond ? "" : " (within noise)"}</span>}
        {delta === null && props.noise !== null && <span className="muted small" style={{ display: "block" }}>{band(props.noise)} noise</span>}
      </span>
    </div>
  );
}
