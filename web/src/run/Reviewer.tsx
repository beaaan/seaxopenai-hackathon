import { useMemo, type ReactNode } from "react";
import type { AllocationDecision, ThreadItemRecord } from "@shared/schema";
import type { RunContext } from "../pages/RunPage";
import { Empty, Panel, Pill, TitleRow } from "../ui";

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

export function Reviewer(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const dims = new Map(model.dimensions.map((d) => [d.id, d.name]));
  const toolCalls = useMemo(() => model.threads.filter((t) => t.role === "reviewer" && t.itemType === "dynamicToolCall"), [model.threads]);
  const probeCalls = useMemo(() => model.threads.filter((t) => t.role === "probe" && t.itemType === "dynamicToolCall"), [model.threads]);
  const byReviewer = model.allocations.filter((a) => a.decidedBy === "reviewer").length;
  return (
    <>
      <TitleRow
        title="Reviewer agent"
        sub={model.allocations.length === 0 ? "The reviewer decides who reads next once the first batch is in." : <>{model.allocations.length} {model.allocations.length === 1 ? "batch" : "batches"} allocated, {byReviewer} by the reviewer agent{byReviewer < model.allocations.length ? `, ${model.allocations.length - byReviewer} by the fallback rule` : ""}.</>}
        meta={<span>A persistent Codex App Server thread reads which traits split the readings, inspects beliefs through its tools and allocates the next batch. Code enforces the budget, a 20% random share and the schema.</span>}
      />
      {model.allocations.length === 0 ? <Empty>No allocation decisions yet.</Empty> : (
        <div className="grid">
          <div className="c7 stack">{model.allocations.map((a) => <Decision key={a.batch} decision={a} dimName={(id) => dims.get(id) ?? id} />)}</div>
          <div className="c5">
            <Panel title="Tool calls" meta={`${toolCalls.length} calls`}>
              {toolCalls.length === 0 ? <p className="muted">None recorded.</p> : <ul className="rows">{toolCalls.map((t, i) => <ToolCall key={i} record={t} />)}</ul>}
            </Panel>
          </div>
        </div>
      )}
      {model.probe && (
        <Panel className="" title="Incentive probe" meta={<Pill tone="warn">Hypothetical, under stated assumptions</Pill>}>
          <p>{model.probe.hypothesis}</p>
          <div className="grid" style={{ marginTop: 14 }}>
            <div className="c6">
              <h3>Assumptions, not the platform's rules</h3>
              <ul className="rows">{model.probe.assumptions.map((a) => <li key={a.id} className="row" style={{ alignItems: "flex-start" }}><span className="id">{a.id}</span><span>{a.text}</span></li>)}</ul>
            </div>
            <div className="c6">
              <h3>{model.probe.days} simulated days</h3>
              <table style={{ marginTop: 6 }}>
                <tbody>{Object.entries(model.probe.outcome).map(([k, v]) => <tr key={k}><td>{k}</td><td className="n">{String(v)}</td></tr>)}</tbody>
              </table>
              <p className="muted" style={{ marginTop: 10 }}>{model.probe.summary}</p>
            </div>
          </div>
          {probeCalls.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="small muted" style={{ cursor: "pointer" }}>{probeCalls.length} persona actions in the sandbox</summary>
              <ul className="rows" style={{ marginTop: 6 }}>{probeCalls.map((t, i) => <ToolCall key={i} record={t} />)}</ul>
            </details>
          )}
        </Panel>
      )}
    </>
  );
}

function Decision(props: { decision: AllocationDecision; dimName: (id: string) => string }): ReactNode {
  const d = props.decision;
  const top = [...d.split].sort((a, b) => b.z - a.z).slice(0, 4);
  const discovered = d.discovery.at(-1);
  return (
    <Panel
      title={`Batch ${d.batch}`}
      meta={<span className="pills" style={{ justifyContent: "flex-end" }}>
        <Pill tone={d.decidedBy === "reviewer" ? "accent" : "warn"}>{d.decidedBy === "reviewer" ? "Reviewer agent" : "Fallback rule"}</Pill>
        {d.stopExploring ? <Pill tone="pos">Stop exploring</Pill> : <Pill>{d.n} more readers</Pill>}
      </span>}
    >
      <p>{d.rationale}</p>
      {discovered && <p className="small muted" style={{ marginTop: 6 }}>{discovered.newClusters} new shared beliefs in the previous batch.</p>}
      <table style={{ marginTop: 10 }}>
        <thead><tr><th>Trait that splits readings</th><th className="n">Split z</th><th className="hide-phone">Readers per level</th></tr></thead>
        <tbody>
          {top.map((row) => (
            <tr key={row.dimId}>
              <td>{props.dimName(row.dimId)}{d.focusDimIds.includes(row.dimId) && <> <Pill tone="accent">Focus</Pill></>}</td>
              <td className="n">{row.z.toFixed(1)}</td>
              <td className="hide-phone small muted">{row.byLevel.map((l) => `${l.levelId} ${l.n}`).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function ToolCall(props: { record: ThreadItemRecord }): ReactNode {
  const tool = field(props.record.item, "tool") ?? field(props.record.item, "name");
  const args = field(props.record.item, "arguments");
  return (
    <li className="row" style={{ alignItems: "flex-start", flexDirection: "column", gap: 2 }}>
      <span className="id" style={{ color: "var(--text)" }}>{String(tool ?? props.record.itemType)}</span>
      <span className="id" style={{ wordBreak: "break-all" }}>{typeof args === "string" ? args : JSON.stringify(args ?? {})}</span>
    </li>
  );
}
