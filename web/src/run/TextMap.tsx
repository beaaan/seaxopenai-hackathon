import { useMemo, useState, type ReactNode } from "react";
import type { Cluster, Interpretation, Reading, Scenario } from "@shared/schema";
import { distinctReaders, finalVersion, hasReference, originalReadings, scenarioById, sentenceHeat, type SentenceHeat } from "../model";
import type { RunContext } from "../pages/RunPage";
import { Empty, Panel, Pill, Track, Who, pct } from "../ui";

export const NOT_IN_TEXT = "not-in-text";

interface Atom {
  interpretation: Interpretation;
  reading: Reading;
  scenario: Scenario | undefined;
}

/** How many readers the heat is measured against: the original cohort. */
export function cohortSize(ctx: RunContext): number {
  return originalReadings(ctx.model).length || ctx.model.scenarios.length;
}

export function useHeat(ctx: RunContext): { heat: Map<string | null, SentenceHeat>; hottest: string | null } {
  const heat = useMemo(() => sentenceHeat(ctx.model), [ctx.model]);
  const top = [...heat.values()].sort((a, b) => b.readers - a.readers)[0];
  return { heat, hottest: top === undefined ? null : (top.sentenceId ?? NOT_IN_TEXT) };
}

/** The signature: the policy's own sentences are the axis; each one carries a bar of readers who share a misreading of it. */
export function TextMap(props: { ctx: RunContext; selected: string | null; onSelect: (id: string) => void }): ReactNode {
  const { model } = props.ctx;
  const { heat } = useHeat(props.ctx);
  const total = cohortSize(props.ctx);
  const finalV = finalVersion(model);
  const [shownVersion, setShownVersion] = useState(0);
  const v0 = model.versions.find((v) => v.version === 0);
  const shown = model.versions.find((v) => v.version === shownVersion) ?? v0;
  const v0Texts = new Set(v0?.sentences.map((s) => s.text.trim()) ?? []);
  const notInText = heat.get(null);

  const toggle = finalV > 0 ? (
    <div className="segmented" role="group" aria-label="Version">
      {[0, finalV].map((v) => <button key={v} aria-pressed={shownVersion === v} onClick={() => setShownVersion(v)}>{v === 0 ? "Original" : `Rewrite v${v}`}</button>)}
    </div>
  ) : <span>Readers sharing a misreading, of {total}</span>;

  if (!v0 || !shown) return <Panel title="The text, by misreading"><Empty>Waiting for the policy text.</Empty></Panel>;

  return (
    <Panel title={shownVersion === 0 ? "The text, by misreading" : `Rewrite v${shownVersion}`} meta={toggle}>
      <div className="textmap">
        {shownVersion === 0 && (
          <div className="axis" aria-hidden>
            <span>Sentence</span><span />
            <span style={{ display: "flex", justifyContent: "space-between", paddingRight: 36 }}><span>0</span><span>{total} readers</span></span>
          </div>
        )}
        {shown.surfaces.map((surface) => (
          <div key={surface.id}>
            <div className="surface">{surface.label}</div>
            {shown.sentences.filter((s) => s.surfaceId === surface.id).map((sentence) => {
              if (shownVersion !== 0) {
                const changed = !v0Texts.has(sentence.text.trim());
                return (
                  <div key={sentence.id} className={changed ? "sline changed" : "sline"}>
                    <span className="id">{sentence.id}</span>
                    <span>{sentence.text}</span>
                    <span className="small muted" style={{ paddingTop: 2 }}>{changed ? "Changed by the rewrite" : ""}</span>
                  </div>
                );
              }
              const readers = heat.get(sentence.id)?.readers ?? 0;
              return (
                <button key={sentence.id} className="sline" aria-pressed={props.selected === sentence.id} onClick={() => props.onSelect(sentence.id)}>
                  <span className="id">{sentence.id}</span>
                  <span>{sentence.text}</span>
                  <HeatBar readers={readers} total={total} />
                </button>
              );
            })}
          </div>
        ))}
        {shownVersion === 0 && notInText && (
          <button className="sline gap" aria-pressed={props.selected === NOT_IN_TEXT} onClick={() => props.onSelect(NOT_IN_TEXT)}>
            <span className="id">–</span>
            <span>Rules readers assumed that the text never states</span>
            <HeatBar readers={notInText.readers} total={total} />
          </button>
        )}
      </div>
    </Panel>
  );
}

function HeatBar(props: { readers: number; total: number }): ReactNode {
  return (
    <span className="heat">
      <Track value={props.total ? props.readers / props.total : 0} label={`${props.readers} of ${props.total} readers`} />
      <span className="num">{props.readers === 0 ? <span className="dash">–</span> : props.readers}</span>
    </span>
  );
}

/** What readers believe about one sentence (or about rules the text never states), with their own words. */
export function BeliefDetail(props: { ctx: RunContext; selected: string | null }): ReactNode {
  const { model } = props.ctx;
  const { heat } = useHeat(props.ctx);
  const scenarios = useMemo(() => scenarioById(model), [model]);
  const atoms = useMemo(() => {
    const out = new Map<string, Atom>();
    for (const reading of model.readings) for (const interpretation of reading.interpretations) out.set(interpretation.id, { interpretation, reading, scenario: scenarios.get(reading.scenarioId) });
    return out;
  }, [model, scenarios]);
  const [all, setAll] = useState(false);
  const total = cohortSize(props.ctx);
  const sentence = props.selected === NOT_IN_TEXT ? null : model.versions[0]?.sentences.find((s) => s.id === props.selected) ?? null;
  const entry = props.selected === null ? undefined : heat.get(props.selected === NOT_IN_TEXT ? null : props.selected);
  const title = props.selected === NOT_IN_TEXT ? "Not in the text" : props.selected ?? "Pick a sentence";
  const clusters = entry?.clusters ?? [];
  const shown = all ? clusters : clusters.slice(0, 3);

  return (
    <Panel
      className="sticky"
      title={<span style={{ fontFamily: props.selected === NOT_IN_TEXT ? undefined : "var(--mono)" }}>{title}</span>}
      meta={entry ? `${entry.readers} of ${total} readers` : undefined}
    >
      {sentence && <p className="cite">{sentence.text}</p>}
      {props.selected === NOT_IN_TEXT && <p className="muted">Beliefs about rules this text never states: readers filled the gap themselves.</p>}
      <div style={{ marginTop: 16 }}>
        {entry === undefined ? (
          <p className="muted">{heat.size === 0 ? "Shared beliefs appear here as readers finish." : "No belief about this sentence is shared by two or more readers."}</p>
        ) : shown.map((cluster) => <Belief key={cluster.id} cluster={cluster} atoms={atoms} graded={hasReference(model)} />)}
      </div>
      {clusters.length > 3 && <button className="btn ghost" style={{ marginTop: 12, paddingLeft: 0 }} onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${clusters.length} beliefs`}</button>}
    </Panel>
  );
}

function Belief(props: { cluster: Cluster; atoms: Map<string, Atom>; graded: boolean }): ReactNode {
  const { cluster } = props;
  const samples = cluster.interpretationIds.map((id) => props.atoms.get(id)).filter((a): a is Atom => a !== undefined);
  const quotes = samples.filter((a, i) => samples.findIndex((b) => b.reading.id === a.reading.id) === i).slice(0, 2);
  return (
    <div className="belief">
      <div className="head">
        <b>{cluster.labelEn}</b>
        <span className="num muted" style={{ whiteSpace: "nowrap" }}>{distinctReaders(cluster)} readers</span>
      </div>
      <div className="small muted" style={{ marginTop: 2 }}>{cluster.labelVi}</div>
      {props.graded && cluster.conflictShare > 0 && <div style={{ marginTop: 6 }}><Pill tone="neg">{pct(cluster.conflictShare)} contradict the reference</Pill></div>}
      {quotes.map(({ interpretation, scenario }) => (
        <blockquote key={interpretation.id} className="quote">
          <div>{interpretation.meaningVi}</div>
          <div className="small muted">{interpretation.glossEn}</div>
          {scenario && (
            <div className="who">
              <Who name={scenario.persona.name} seed={scenario.id} />
              <span>{scenario.persona.name}, {scenario.persona.age}, {scenario.persona.province} · {scenario.exposure.attention === "skim" ? "skimmed" : "read carefully"}</span>
            </div>
          )}
        </blockquote>
      ))}
    </div>
  );
}
