import { useMemo, useState, type ReactNode } from "react";
import { CircleCheck, CircleDashed, FlaskConical, Loader2 } from "lucide-react";
import type { FolkVersion, Interpretation, Scenario } from "@shared/schema";
import { CLASS_LABEL, CLASS_MEANING, STAGES, cohortSize, misreadings, originalReadings, quoted, scenarioById, type Misreading } from "../model";
import type { RunContext } from "../pages/RunPage";
import { Empty, Panel, Pill, TitleRow, Who, cx, hostOf } from "../ui";
import { CLASS_TONE } from "./Findings";
import { tunnelData } from "../landing/tunnel";
import { ReaderFlow } from "../landing/ReaderFlow";

interface Row extends Misreading {
  /** Holders by what they had heard before reading: folk version id, or null for nothing. */
  heard: Map<string | null, number>;
}

/** The report a first-time viewer reads: what was tested, what people got wrong, and which sentence caused it. */
export function Overview(props: { ctx: RunContext }): ReactNode {
  const { model, policy } = props.ctx;
  const total = cohortSize(model);
  const scenarios = useMemo(() => scenarioById(model), [model]);
  const folk = useMemo(() => new Map((policy?.folk.versions ?? []).map((f) => [f.id, f])), [policy]);
  const rows = useMemo<Row[]>(() => misreadings(model).map((m) => {
    const heard = new Map<string | null, number>();
    for (const id of m.readers) {
      const key = scenarios.get(id)?.exposure.folkVersionId ?? null;
      heard.set(key, (heard.get(key) ?? 0) + 1);
    }
    return { ...m, heard };
  }), [model, scenarios]);
  const named = model.findings.length > 0;
  const [picked, setPicked] = useState<string | null>(null);
  const selected = rows.find((r) => r.id === picked) ?? rows[0] ?? null;
  const told = (folkId: string): number => model.scenarios.filter((s) => s.exposure.folkVersionId === folkId).length;
  const heardNothing = model.scenarios.filter((s) => s.exposure.folkVersionId === null).length;
  const explore = model.config?.mode === "explore";
  const title = policy?.package.title ?? model.config?.policyId ?? model.runId;
  const tunnel = useMemo(() => (policy && model.status !== "running" && model.findings.length > 0 ? tunnelData(model, policy.folk.versions) : null), [model, policy]);

  // The headline: the most-held misreading and, as plain counts, what its holders had heard before reading. No claim
  // that the belief *is* the rumour: exposure is recorded per reader, a rumour↔misreading match is not.
  const top = rows[0];
  let headline: ReactNode = model.status === "running" ? "Readers are still reading." : "No two readers share a wrong idea.";
  if (top) {
    const [rumourId, exposed] = [...top.heard.entries()].filter(([k]) => k !== null).sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
    const rumour = rumourId === null ? undefined : folk.get(rumourId);
    const nothing = top.heard.get(null) ?? 0;
    headline = (
      <>
        <b style={{ fontWeight: 600 }}>{top.readers.length} of {total} readers</b> believe {quoted(top.title)}.
        {rumour && exposed * 2 > top.readers.length && <> {exposed} of the {told(rumour.id)} told “{shortClaim(rumour)}” first do. {nothing === 0 ? "None" : nothing} of the {heardNothing} who heard nothing do.</>}
      </>
    );
  }

  return (
    <>
      <TitleRow
        title={title}
        sub={headline}
        meta={<>
          {policy?.package.sourceUrls[0] && <a className="link" href={policy.package.sourceUrls[0]} target="_blank" rel="noreferrer">{hostOf(policy.package.sourceUrls[0])}</a>}
          {model.startedAt && <span>Tested {new Date(model.startedAt).toLocaleString()}</span>}
          <span className="id">{model.runId}</span>
        </>}
        actions={!explore && model.versions.length > 0 ? <a className="btn primary" href={`#/run/${encodeURIComponent(model.runId)}/ci`}><FlaskConical /> Test an edit</a> : undefined}
      />

      {tunnel && (
        <section className="tunnel-panel" aria-label="How readers moved through the text">
          <div className="tunnel-panel-head">
            <b>{tunnel.total} readers: what they heard, where they read it, what they came to believe</b>
          </div>
          <ReaderFlow data={tunnel} active={tunnel.pools.findIndex((p) => p.id === selected?.id)} onActive={(i) => {
            const id = tunnel.pools[i]?.id;
            if (id && rows.some((r) => r.id === id)) setPicked(id);
          }} />
        </section>
      )}

      {model.status === "running" && <Progress ctx={props.ctx} />}

      <div className="grid">
        <div className="c7">
          <Panel flush title={named ? "What readers got wrong" : "What readers came away believing"}>
            {!named && rows.length > 0 && <p className="lede" style={{ padding: "0 var(--card-pad)", margin: "6px 0 0" }}>{explore ? "Grouped, not yet judged against the policy." : "Named once every reader has read the text."}</p>}
            {rows.length === 0 ? <div style={{ padding: 20 }}><Empty>Nothing yet: ideas appear once two readers share one.</Empty></div> : (
              <ul className="misreadings">
                {rows.map((row) => (
                  <li key={row.id}>
                    <button aria-pressed={selected?.id === row.id} onClick={() => {
                      setPicked(row.id);
                      // Below 1100px the detail stacks under the list: bring it into view.
                      if (window.matchMedia("(max-width: 1100px)").matches) requestAnimationFrame(() => document.getElementById("misreading-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
                    }}>
                      <span className="count num">{row.readers.length}<small>of {total}</small></span>
                      <span className="what">
                        <span className="title">{row.title}</span>
                        <span className="small muted">{heardLine(row, folk)}</span>
                      </span>
                      {row.kind && <Pill tone={CLASS_TONE[row.kind]}>{CLASS_LABEL[row.kind]}</Pill>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="c5" id="misreading-detail">{selected && <Detail ctx={props.ctx} row={selected} folk={folk} />}</div>
      </div>

      {folk.size > 0 && <Rumours folk={[...folk.values()]} told={told} />}
    </>
  );
}

function heardLine(row: Row, folk: Map<string, FolkVersion>): string {
  return [...row.heard.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => (id === null ? `${n} had heard nothing` : `${n} had heard “${shortClaim(folk.get(id))}”`))
    .join(" · ");
}

function shortClaim(f: FolkVersion | undefined): string {
  if (!f) return "a rumour";
  const text = f.claimEn.replace(/\.$/, "");
  return text.length > 48 ? `${text.slice(0, 46)}…` : text;
}

interface Quote {
  interpretation: Interpretation;
  scenario: Scenario | undefined;
}

function Detail(props: { ctx: RunContext; row: Row; folk: Map<string, FolkVersion> }): ReactNode {
  const { model } = props.ctx;
  const row = props.row;
  const quotes = useMemo<Quote[]>(() => {
    const scenarios = scenarioById(model);
    const wanted = new Set(row.interpretationIds);
    const out: Quote[] = [];
    const seen = new Set<string>();
    for (const reading of model.readings) {
      if (seen.has(reading.scenarioId)) continue;
      const interpretation = reading.interpretations.find((i) => wanted.has(i.id));
      if (!interpretation) continue;
      seen.add(reading.scenarioId);
      out.push({ interpretation, scenario: scenarios.get(reading.scenarioId) });
      if (out.length === 2) break;
    }
    return out;
  }, [row, model]);
  const v0 = model.versions.find((v) => v.version === 0);
  const marked = new Set(row.sentenceIds);

  return (
    <Panel className="sticky" title={row.title}>
      {row.kind && (
        <>
          <div className="pills"><Pill tone={CLASS_TONE[row.kind]}>{CLASS_LABEL[row.kind]}</Pill></div>
          <p style={{ marginTop: 10 }}>{CLASS_MEANING[row.kind]}</p>
        </>
      )}
      {row.summary && <p className="muted" style={{ marginTop: 8 }}>{row.summary}</p>}

      {quotes.length > 0 && (
        <>
          <h3 style={{ marginTop: 18 }}>In readers’ own words</h3>
          {quotes.map(({ interpretation, scenario }) => (
            <blockquote key={interpretation.id} className="quote">
              <div lang="vi">{interpretation.meaningVi}</div>
              <div className="small muted">{interpretation.glossEn}</div>
              {scenario && (
                <div className="who">
                  <Who name={scenario.persona.name} seed={scenario.id} />
                  <span>{scenario.persona.name}, {scenario.persona.age}, {scenario.persona.province}{scenario.exposure.folkVersionId ? ` · had heard “${shortClaim(props.folk.get(scenario.exposure.folkVersionId))}”` : " · had heard nothing"}</span>
                </div>
              )}
            </blockquote>
          ))}
        </>
      )}

      <h3 style={{ marginTop: 18 }}>Where in the text</h3>
      {marked.size === 0 && <p className="muted" style={{ marginTop: 4 }}>No sentence says this. Readers filled a gap in the text themselves.</p>}
      {v0 && (
        <div className="passage">
          {v0.surfaces.map((surface) => (
            <div key={surface.id}>
              <div className="small muted" style={{ margin: "10px 0 4px" }}>{surface.label}</div>
              {v0.sentences.filter((s) => s.surfaceId === surface.id).map((s) => (
                <p key={s.id} lang="vi" className={cx(marked.has(s.id) && "mark")}>{s.text}</p>
              ))}
            </div>
          ))}
        </div>
      )}
      {row.kind && <a className="link small" style={{ display: "inline-block", marginTop: 12 }} href={`#/run/${encodeURIComponent(model.runId)}/findings`}>Details and the attempted fix</a>}
    </Panel>
  );
}

function Rumours(props: { folk: FolkVersion[]; told: (id: string) => number }): ReactNode {
  const shown = [...props.folk].sort((a, b) => props.told(b.id) - props.told(a.id));
  return (
    <Panel title="What people hear instead" meta={`${shown.length} versions found online`} lede="Versions of the rule that circulate on websites and by word of mouth. None of them is in the official text. Some readers were told one before reading, the way a friend would.">
      <table>
        <thead><tr><th>What people say</th><th className="hide-phone">Where</th><th className="n">Readers told it</th></tr></thead>
        <tbody>
          {shown.map((f) => (
            <tr key={f.id}>
              <td>{f.claimEn}<span className="sub" lang="vi">“{f.textVi}”</span></td>
              <td className="hide-phone small muted" style={{ whiteSpace: "nowrap" }}>{hostOf(f.source)}{f.date ? <><br />{f.date}</> : null}</td>
              <td className="n">{props.told(f.id) === 0 ? <span className="dash">0</span> : props.told(f.id)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function Progress(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const read = originalReadings(model).length;
  return (
    <Panel title="This test is running" meta={`${read} of ${model.scenarios.length || "…"} readers have read the text`}>
      <ol className="stages progress">
        {STAGES.map((stage, i) => {
          const done = stage.done(model);
          const now = !done && (i === 0 || STAGES[i - 1]!.done(model));
          return (
            <li key={stage.id} className={cx("stage", done && "done", now && "now")}>
              {done ? <CircleCheck style={{ color: "var(--accent)" }} /> : now ? <Loader2 className="spin" /> : <CircleDashed style={{ color: "var(--faint)" }} />}
              <span>{stage.label}</span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
