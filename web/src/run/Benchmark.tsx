import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { originalReadings } from "../model";
import type { RunContext } from "../pages/RunPage";
import { Empty, Panel, TitleRow, Track, pct } from "../ui";

export function Benchmark(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const score = model.score;
  const replicates = model.baselines.filter((b) => /^baseline-\d+$/.test(b.id)).length;
  const cost = (systemId: string): string => {
    if (systemId === "wind-tunnel") return `${originalReadings(model).length} persona readings`;
    if (systemId === "baseline-mean" || systemId === "baseline-union") return `${replicates} single-pass runs`;
    return "1 call";
  };
  const name = (id: string, label: string): string => (id === "wind-tunnel" ? "Policy Wind Tunnel" : label);
  const edgeCases = score ? [...new Set(score.matches.map((m) => m.edgeCaseId))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))) : [];
  const unmatched = score?.outsideReference.filter((o) => o.systemId === "wind-tunnel").length ?? 0;
  const ours = score?.systems.find((s) => s.id === "wind-tunnel") ?? null;
  const single = score?.systems.find((s) => s.id === "baseline-mean") ?? null;

  return (
    <>
      <TitleRow
        title="Benchmark"
        sub={ours && single
          ? <>The wind tunnel recalled {pct(ours.recall)} of the team's holdout edge cases; one careful model reading the same text recalled {pct(single.recall)} on average.</>
          : "Recall on edge cases the team wrote by hand and never showed to the pipeline, against one careful model reading the same text."}
        meta={<span>Scored blind: items are anonymised and shuffled before a separate model decides matches.</span>}
      />
      {!score ? (
        <>
          <Panel title="Holdout recall">
            <Empty>Scoring needs the team's holdout edge cases, written by a person. Until then, the two systems' raw output is below.</Empty>
          </Panel>
          {model.baselines.length > 0 && <SideBySide ctx={props.ctx} />}
        </>
      ) : (
        <div className="grid">
          <div className="c5">
            <Panel title={`Recall on ${edgeCases.length} edge cases`}>
              <ul className="rows">
                {[...score.systems].sort((a, b) => b.recall - a.recall).map((s) => (
                  <li key={s.id} className="row" style={{ display: "grid", gridTemplateColumns: "1fr 48px", gap: "4px 12px" }}>
                    <span style={{ fontWeight: s.id === "wind-tunnel" ? 500 : 400 }}>{name(s.id, s.label)}<span className="small muted" style={{ display: "block" }}>{cost(s.id)}</span></span>
                    <span className="num" style={{ textAlign: "right", fontWeight: s.id === "wind-tunnel" ? 500 : 400 }}>{pct(s.recall)}</span>
                    <span style={{ gridColumn: "1 / -1" }}><Track value={s.recall} muted={s.id !== "wind-tunnel"} /></span>
                  </li>
                ))}
              </ul>
              {unmatched > 0 && <p className="small muted" style={{ marginTop: 12 }}>{unmatched} wind-tunnel finding{unmatched > 1 ? "s" : ""} matched no edge case: not validated and not disproved.</p>}
            </Panel>
          </div>
          <div className="c7">
            <Panel flush title="Which system found which edge case">
              <div className="table-wrap" style={{ marginTop: 4 }}>
                <table>
                  <thead><tr><th>Edge case</th>{score.systems.map((s) => <th key={s.id} className="n">{s.id === "wind-tunnel" ? "Wind tunnel" : s.id.replace("baseline-", "Baseline ")}</th>)}</tr></thead>
                  <tbody>
                    {edgeCases.map((edge) => (
                      <tr key={edge}>
                        <td className="id">{edge}</td>
                        {score.systems.map((s) => {
                          const m = score.matches.find((x) => x.edgeCaseId === edge && x.systemId === s.id);
                          return <td key={s.id} className="n" title={m?.why}>{m?.matched ? <Check size={15} style={{ display: "inline", color: s.id === "wind-tunnel" ? "var(--chart-1)" : "var(--text)" }} /> : <span className="dash">–</span>}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}

/** Raw output of both systems on the same text, before any scoring. */
function SideBySide(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const replicates = model.baselines.filter((b) => /^baseline-\d+$/.test(b.id));
  const first = replicates[0] ?? model.baselines[0]!;
  const scenarioOf = new Map(model.readings.map((r) => [r.id, r.scenarioId]));
  const total = originalReadings(model).length;
  return (
    <div className="grid">
      <div className="c6">
        <Panel title="Policy Wind Tunnel" meta={`${model.findings.length} findings from ${total} readers`}>
          <ul className="rows">
            {model.findings.map((f) => (
              <li key={f.id} className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <span>{f.title}<span className="small muted" style={{ display: "block" }}>{f.sentenceIds.length ? <span className="id">{f.sentenceIds.join(", ")}</span> : "not in the text"}</span></span>
                <span className="num muted" style={{ whiteSpace: "nowrap" }}>{new Set(f.evidence.readingIds.map((id) => scenarioOf.get(id) ?? id)).size} readers</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      <div className="c6">
        <Panel title="One careful model" meta={`${first.model} · ${first.effort} · run 1 of ${replicates.length || 1}`}>
          <ul className="rows">
            {first.issues.map((issue) => (
              <li key={issue.id} className="row" style={{ alignItems: "flex-start", flexDirection: "column", gap: 2 }}>
                <span>{issue.issue}</span>
                <span className="small muted" lang="vi">“{issue.sentenceQuote}”</span>
              </li>
            ))}
          </ul>
          {replicates.length > 1 && <p className="small muted" style={{ marginTop: 8 }}>Other runs raised {replicates.slice(1).map((r) => r.issues.length).join(", ")} issues.</p>}
        </Panel>
      </div>
    </div>
  );
}
