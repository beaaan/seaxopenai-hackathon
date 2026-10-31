import type { ReactNode } from "react";
import { dimLabel, type Agents, type Persona, type Reviewer } from "./agents";

const ACTION_LABEL: Record<string, string> = {
  switch_prepaid: "switched to prepaid",
  place_order: "placed an order",
  wait_days: "waited",
  refuse_delivery: "refused a delivery",
  new_account: "opened a new account",
};

/** The agents at work, drawn rather than narrated: what they look at, when they think, what they decide. */
export function AgentPanel(props: { agents: Agents }): ReactNode {
  const { agents } = props;
  if (agents.active === "persona" && agents.persona) return <PersonaView p={agents.persona} />;
  if (agents.reviewer) return <ReviewerView r={agents.reviewer} />;
  return null;
}

function Core(props: { thinking: boolean; label: string; tag: string; children?: ReactNode }): ReactNode {
  return (
    <div className="ag-head">
      <span className={props.thinking ? "ag-core thinking" : "ag-core"} aria-hidden="true"><i /><i /><i /></span>
      <b>{props.label}</b>
      <span className="ag-tag">{props.tag}</span>
      {props.children}
    </div>
  );
}

function ReviewerView(props: { r: Reviewer }): ReactNode {
  const { r } = props;
  const max = Math.max(1, ...r.dims.map((d) => d.z));
  const deciding = r.decision !== null && (r.tool === null || r.decision.key > r.tool.key);
  const hit = deciding ? null : r.tool?.dimId ?? null;
  const sweep = !deciding && r.tool?.tool === "get_split_table";
  return (
    <section className="t-agent ag" aria-label="Reviewer agent">
      <Core thinking={r.thinking} label="Reviewer agent" tag="Codex">
        {deciding && r.decision ? (
          <span key={r.decision.key} className="ag-decision">
            {r.decision.stop ? "Stop exploring" : <><b>+{r.decision.n}</b> readers</>}
          </span>
        ) : r.tool ? (
          <span key={r.tool.key} className="ag-tool">{r.tool.tool}{r.tool.levelId ? <span>{r.tool.levelId.replace(/_/g, " ")}</span> : null}</span>
        ) : null}
      </Core>
      <p className="ag-q">Which reader trait splits the beliefs?</p>
      <ol className={sweep ? "ag-dims sweep" : "ag-dims"}>
        {r.dims.map((d, i) => {
          const focus = deciding && r.focus.includes(d.id);
          return (
            <li key={d.id} className={[d.id === hit ? "hit" : "", focus ? "focus" : ""].join(" ")} style={{ ["--i" as string]: i }}>
              <span className="ag-name">{dimLabel(d.id)}</span>
              <span className="ag-track"><i style={{ width: `${(Math.max(0, d.z) / max) * 100}%` }} /></span>
              <span className="ag-z">{d.z.toFixed(1)}</span>
            </li>
          );
        })}
      </ol>
      {deciding && r.decision ? <div key={r.decision.key} className="ag-bubble" lang="vi">{firstSentence(r.decision.said)}</div> : r.thinking ? <div className="ag-bubble thinking"><i /><i /><i /></div> : null}
      {r.discovery.length > 0 && (
        <div className="ag-rounds" aria-label="New shared beliefs per round">
          {r.discovery.map((d) => <i key={d.batch} style={{ height: `${Math.min(100, d.newClusters * 10)}%` }}><span>{d.newClusters}</span></i>)}
          <small>new beliefs per round</small>
        </div>
      )}
    </section>
  );
}

function PersonaView(props: { p: Persona }): ReactNode {
  const { p } = props;
  const acted = new Set(p.actions.map((a) => (a.day === null ? -1 : Math.floor(a.day / 7) + 1)));
  const last = p.actions.at(-1);
  return (
    <section className="t-agent ag persona" aria-label="Persona agent">
      <Core thinking={p.thinking} label={p.name} tag="persona agent · 180 days" />
      <ol className="ag-weeks" aria-label={`Week ${p.week} of ${p.weeks}`}>
        {Array.from({ length: p.weeks }, (_, i) => i + 1).map((w) => (
          <li key={w} className={[w < p.week ? "past" : "", w === p.week ? "now" : "", acted.has(w) ? "acted" : ""].join(" ")} />
        ))}
      </ol>
      <div className="ag-status">
        <span>Week {p.week || 1}</span>
        {p.codAvailable !== null && <span className={p.codAvailable ? "ok" : "bad"}>{p.codAvailable ? "COD available" : "COD locked"}</span>}
        {last && <span key={last.key} className="ag-act">{ACTION_LABEL[last.tool] ?? last.tool}</span>}
      </div>
      {p.thinking ? <div className="ag-bubble thinking"><i /><i /><i /></div> : p.said ? <div key={p.said} className="ag-bubble" lang="vi">{firstSentence(p.said)}</div> : null}
    </section>
  );
}

function firstSentence(text: string): string {
  const s = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return s.length > 120 ? `${s.slice(0, 120).replace(/\s+\S*$/, "")}…` : s;
}
