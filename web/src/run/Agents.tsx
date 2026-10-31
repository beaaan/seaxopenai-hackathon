import { useMemo, type ReactNode } from "react";
import { Bot, FlaskConical, Wrench } from "lucide-react";
import type { AllocationDecision, ThreadItemRecord } from "@shared/schema";
import type { RunContext } from "../pages/RunPage";
import { Badge, Card, Empty, Section } from "../ui";

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

export function Agents(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const dims = new Map(model.dimensions.map((d) => [d.id, d.name]));
  const toolCalls = useMemo(() => model.threads.filter((t) => t.role === "reviewer" && t.itemType === "dynamicToolCall"), [model.threads]);
  const probeCalls = useMemo(() => model.threads.filter((t) => t.role === "probe" && t.itemType === "dynamicToolCall"), [model.threads]);
  return (
    <Section id="agents" kicker="Agents" title="The reviewer that decides who reads next">
      <p className="mb-6 max-w-3xl text-stone-600">
        A persistent Codex App Server thread looks at which reader traits split the readings, inspects clusters through its tools,
        and allocates the next batch. Code enforces the budget, a 20% random share and schema validation.
      </p>
      {model.allocations.length === 0 ? <Empty>No allocation decisions yet.</Empty> : (
        <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
          <div className="space-y-4">
            {model.allocations.map((a) => <Decision key={a.batch} decision={a} dimName={(id) => dims.get(id) ?? id} />)}
          </div>
          <Card className="p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-stone-900"><Wrench size={16} /> Tool calls by the reviewer</div>
            <ul className="mt-3 space-y-2 text-sm">
              {toolCalls.length === 0 && <li className="text-stone-500">None recorded.</li>}
              {toolCalls.map((t, i) => <ToolCall key={i} record={t} />)}
            </ul>
          </Card>
        </div>
      )}
      {model.probe && (
        <Card className="mt-6 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-900"><FlaskConical size={16} /> Incentive probe <Badge tone="warn">hypothetical · under stated assumptions</Badge></div>
          <p className="mt-3 text-stone-800">{model.probe.hypothesis}</p>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold tracking-wide text-stone-400 uppercase">Assumptions (not Shopee's rules)</div>
              <ul className="mt-1 space-y-1 text-sm text-stone-700">{model.probe.assumptions.map((a) => <li key={a.id}><span className="font-mono text-xs text-stone-400">{a.id}</span> {a.text}</li>)}</ul>
            </div>
            <div>
              <div className="text-xs font-semibold tracking-wide text-stone-400 uppercase">{model.probe.days} simulated days</div>
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                {Object.entries(model.probe.outcome).map(([k, v]) => <Badge key={k}>{k}: {v}</Badge>)}
              </div>
              <p className="mt-3 text-sm text-stone-600">{model.probe.summary}</p>
            </div>
          </div>
          {probeCalls.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-stone-600">{probeCalls.length} persona actions in the sandbox</summary>
              <ul className="mt-2 space-y-2 text-sm">{probeCalls.map((t, i) => <ToolCall key={i} record={t} />)}</ul>
            </details>
          )}
        </Card>
      )}
    </Section>
  );
}

function Decision(props: { decision: AllocationDecision; dimName: (id: string) => string }): ReactNode {
  const d = props.decision;
  const top = [...d.split].sort((a, b) => b.z - a.z).slice(0, 4);
  const discovered = d.discovery.at(-1);
  return (
    <Card className="p-6">
      <div className="flex flex-wrap items-center gap-2">
        <Bot size={16} />
        <span className="text-sm font-semibold text-stone-900">Batch {d.batch}</span>
        <Badge tone={d.decidedBy === "reviewer" ? "accent" : "warn"}>{d.decidedBy}</Badge>
        {d.stopExploring ? <Badge tone="good">stop exploring</Badge> : <Badge>{d.n} more readers</Badge>}
        {discovered && <span className="text-xs text-stone-500">{discovered.newClusters} new shared beliefs in the last batch</span>}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-stone-800">{d.rationale}</p>
      <table className="mt-4 w-full text-sm">
        <thead><tr className="text-left text-xs text-stone-500"><th className="py-1 font-medium">Trait</th><th className="py-1 text-right font-medium">split z</th><th className="py-1 pl-4 font-medium">levels</th></tr></thead>
        <tbody>
          {top.map((row) => (
            <tr key={row.dimId} className="border-t border-stone-100 align-top">
              <td className="py-2 pr-2 text-stone-800">{props.dimName(row.dimId)} {d.focusDimIds.includes(row.dimId) && <Badge tone="accent">focus</Badge>}</td>
              <td className="py-2 text-right tabular-nums">{row.z.toFixed(1)}</td>
              <td className="py-2 pl-4 text-xs text-stone-500">{row.byLevel.map((l) => `${l.levelId} (${l.n})`).join(" · ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function ToolCall(props: { record: ThreadItemRecord }): ReactNode {
  const tool = field(props.record.item, "tool") ?? field(props.record.item, "name");
  const args = field(props.record.item, "arguments");
  return (
    <li className="rounded-lg bg-stone-50 px-3 py-2">
      <span className="font-mono text-xs font-semibold text-stone-800">{String(tool ?? props.record.itemType)}</span>
      <span className="ml-2 font-mono text-xs text-stone-500">{typeof args === "string" ? args : JSON.stringify(args ?? {})}</span>
    </li>
  );
}
