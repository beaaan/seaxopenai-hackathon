import { Fragment, useMemo, useState, type ReactNode } from "react";
import type { Grade, Reading, Scenario } from "@shared/schema";
import { originalReadings } from "../model";
import type { RunContext } from "../pages/RunPage";
import { Empty, Panel, Pill, TitleRow, Who, cx, type Tone } from "../ui";

const GRADE_TONE: Record<Grade["label"], Tone> = { consistent: "pos", conflicts: "neg", outside: "warn", unclear: "neutral" };
const GRADE_LABEL: Record<Grade["label"], string> = { consistent: "Consistent", conflicts: "Contradicts", outside: "Not in the text", unclear: "Unclear" };

export function Readers(props: { ctx: RunContext }): ReactNode {
  const { model, policy } = props.ctx;
  const version = model.config?.mode === "retest" ? (model.versions.at(-1)?.version ?? 0) : 0;
  const readings = useMemo(() => new Map(originalReadings(model, version).map((r) => [r.scenarioId, r])), [model, version]);
  const grades = useMemo(() => new Map(model.grades.map((g) => [g.interpretationId, g])), [model.grades]);
  const [filter, setFilter] = useState<{ dimId: string; levelId: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const surfaceLabel = new Map(model.versions[0]?.surfaces.map((s) => [s.id, s.label]) ?? []);
  const folk = new Map(policy?.folk.versions.map((f) => [f.id, f]) ?? []);
  const shown = model.scenarios.filter((s) => filter === null || s.levels.some((l) => l.dimId === filter.dimId && l.levelId === filter.levelId));
  const adaptive = model.scenarios.filter((s) => s.origin === "adaptive").length;
  const level = filter ? model.dimensions.find((d) => d.id === filter.dimId)?.levels.find((l) => l.id === filter.levelId) : undefined;

  return (
    <>
      <TitleRow
        title="Readers"
        sub={<>{model.scenarios.length} simulated readers, chosen so every pair of traits appears together at least once{adaptive > 0 ? <>; {adaptive} added by the reviewer agent where readings split</> : null}.</>}
      />
      <div className="grid">
        <div className="c4">
          <Panel title="Traits" meta={filter ? <button className="btn ghost" style={{ height: 22, padding: 0 }} onClick={() => setFilter(null)}>Clear filter</button> : `${model.dimensions.length} dimensions`}>
            {model.dimensions.length === 0 ? <p className="muted">Traits appear once the sampler has run.</p> : (
              <div className="stack" style={{ gap: 14 }}>
                {model.dimensions.map((dim) => (
                  <div key={dim.id}>
                    <div style={{ fontWeight: 500 }} title={dim.description}>{dim.name}</div>
                    <ul style={{ marginTop: 4 }}>
                      {dim.levels.map((lv) => {
                        const count = model.scenarios.filter((s) => s.levels.some((l) => l.dimId === dim.id && l.levelId === lv.id)).length;
                        const active = filter?.dimId === dim.id && filter.levelId === lv.id;
                        return (
                          <li key={lv.id}>
                            <button
                              className={cx("nav-item")}
                              aria-current={active ? "true" : undefined}
                              style={{ width: "100%", border: 0, background: active ? "var(--active)" : "transparent", textAlign: "left", minHeight: 28, padding: "4px 8px", marginLeft: -8, alignItems: "flex-start" }}
                              title={lv.description}
                              onClick={() => setFilter(active ? null : { dimId: dim.id, levelId: lv.id })}
                            >
                              <span style={{ flex: 1 }}>{lv.label}</span>
                              <span className="count">{count}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
        <div className="c8">
          <Panel flush title={level ? level.label : "Every reader"} meta={`${shown.length} readers`}>
            {shown.length === 0 ? <div style={{ padding: 20 }}><Empty>No readers yet.</Empty></div> : (
              <div className="table-wrap" style={{ marginTop: 4 }}>
                <table>
                  <thead><tr><th>Reader</th><th>In their words</th><th className="hide-phone">Read</th></tr></thead>
                  <tbody>
                    {shown.map((s) => {
                      const r = readings.get(s.id) ?? null;
                      const isOpen = open === s.id;
                      return (
                        <Fragment key={s.id}>
                          <tr className="pick" aria-selected={isOpen} onClick={() => setOpen(isOpen ? null : s.id)}>
                            <td style={{ width: 230 }}>
                              <span style={{ display: "flex", gap: 10 }}>
                                <Who name={s.persona.name} seed={s.id} />
                                <span>{s.persona.name}, {s.persona.age}<span className="sub">{s.persona.occupation} · {s.persona.province}</span></span>
                              </span>
                            </td>
                            <td lang="vi">{r ? <span style={{ display: "-webkit-box", WebkitLineClamp: isOpen ? "unset" : 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{r.paraphraseVi}</span> : <span className="muted">Reading</span>}</td>
                            <td className="hide-phone" style={{ width: 150 }}>
                              <div className="pills">
                                <Pill tone={s.exposure.attention === "skim" ? "warn" : "neutral"}>{s.exposure.attention === "skim" ? "Skimmed" : "Careful"}</Pill>
                                {s.exposure.folkVersionId && <Pill tone="warn" title={folk.get(s.exposure.folkVersionId)?.textVi}>Heard a rumour</Pill>}
                                {s.origin === "adaptive" && <Pill tone="accent" title={s.allocationReason ?? undefined}>Targeted</Pill>}
                              </div>
                            </td>
                          </tr>
                          {isOpen && r && (
                            <tr>
                              <td colSpan={3} style={{ background: "var(--raised)", padding: 20 }}>
                                <ReaderDetail scenario={s} reading={r} grades={grades} surfaceLabel={(id) => surfaceLabel.get(id) ?? id} folkText={(id) => folk.get(id)?.textVi ?? id} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function ReaderDetail(props: { scenario: Scenario; reading: Reading; grades: Map<string, Grade>; surfaceLabel: (id: string) => string; folkText: (id: string) => string }): ReactNode {
  const { scenario: s, reading: r } = props;
  return (
    <div className="grid" style={{ gap: 20 }}>
      <div className="c5" lang="vi">
        <h3>Situation</h3>
        <p style={{ marginTop: 4 }}>{s.situationVi}</p>
        <p className="small muted" style={{ marginTop: 6 }}>Read: {s.exposure.surfaceIds.map(props.surfaceLabel).join(", ")}</p>
        {s.exposure.folkVersionId && <p className="cite" style={{ marginTop: 10 }}>Heard: “{props.folkText(s.exposure.folkVersionId)}”</p>}
        <h3 style={{ marginTop: 14 }}>Would do</h3>
        <ul style={{ marginTop: 4, display: "grid", gap: 4 }}>{r.actions.map((a, i) => <li key={i}><span className="id">{a.action}</span> {a.detailVi}</li>)}</ul>
        <h3 style={{ marginTop: 14 }}>Feels</h3>
        <p style={{ marginTop: 4 }}>{r.feelingVi}</p>
      </div>
      <div className="c7">
        <h3>Interpretations</h3>
        <ul className="rows" style={{ marginTop: 4 }}>
          {r.interpretations.map((i) => {
            const g = props.grades.get(i.id);
            return (
              <li key={i.id} className="row" style={{ alignItems: "flex-start", flexDirection: "column", gap: 2 }}>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="id">{i.sentenceId ?? "not in text"}</span>
                  {g && g.label !== "unclear" && <Pill tone={GRADE_TONE[g.label]}>{GRADE_LABEL[g.label]}</Pill>}
                </span>
                <span lang="vi">{i.meaningVi}</span>
                <span className="small muted">{i.glossEn}</span>
              </li>
            );
          })}
        </ul>
        {r.questions.length > 0 && (
          <>
            <h3 style={{ marginTop: 14 }}>Still asks</h3>
            <ul style={{ marginTop: 4, display: "grid", gap: 4 }}>{r.questions.map((q) => <li key={q.id} lang="vi">{q.questionVi} <span className="small muted">({q.glossEn})</span></li>)}</ul>
          </>
        )}
      </div>
    </div>
  );
}
