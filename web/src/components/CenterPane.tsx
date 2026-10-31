import type { ReactNode } from "react";
import type { RunEvent } from "@shared/events";
import type { AllocationDecision, Dimension } from "@shared/schema";
import { EVENT_META, eventSummary, pct, SectionTitle } from "../ui";

const FEED_LIMIT = 300;

export function EventFeed(props: { events: readonly RunEvent[] }): ReactNode {
  const shown = props.events.slice(-FEED_LIMIT).reverse();
  return (
    <section className="flex min-h-0 flex-1 flex-col rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <SectionTitle right={<span className="text-xs text-slate-400">{props.events.length} events</span>}>Event feed</SectionTitle>
      <ol className="min-h-0 flex-1 overflow-y-auto font-mono text-sm">
        {shown.map((e) => {
          const meta = EVENT_META[e.type];
          return (
            <li key={e.seq} className="flex gap-2 truncate border-b border-slate-100 py-0.5" title={eventSummary(e)}>
              <span className="w-8 shrink-0 text-right text-slate-400">{e.seq}</span>
              <span className="w-5 shrink-0 text-center">{meta.icon}</span>
              <span className={`w-36 shrink-0 font-semibold ${meta.tone}`}>{meta.label}</span>
              <span className="truncate text-slate-700">{eventSummary(e)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function DiscoveryCurve(props: { decision: AllocationDecision }): ReactNode {
  let cumulative = 0;
  const points = [{ x: 0, y: 0 }];
  for (const p of props.decision.discovery) {
    cumulative += p.newClusters;
    points.push({ x: p.readings, y: cumulative });
  }
  const maxX = Math.max(1, ...points.map((p) => p.x));
  const maxY = Math.max(1, ...points.map((p) => p.y));
  const w = 160;
  const h = 56;
  const pad = 4;
  const sx = (x: number): number => pad + (x / maxX) * (w - 2 * pad);
  const sy = (y: number): number => h - pad - (y / maxY) * (h - 2 * pad);
  return (
    <svg width={w} height={h} className="rounded bg-slate-50 ring-1 ring-slate-200" aria-label="discovery curve">
      <polyline fill="none" stroke="#7c3aed" strokeWidth={2} points={points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")} />
      {points.map((p) => (
        <circle key={`${p.x}-${p.y}`} cx={sx(p.x)} cy={sy(p.y)} r={2.5} fill="#7c3aed" />
      ))}
      <text x={w - pad} y={12} textAnchor="end" fontSize={10} fill="#64748b">
        {maxY} clusters / {maxX} readings
      </text>
    </svg>
  );
}

export function AllocationPanel(props: { decisions: AllocationDecision[]; dimensions: Dimension[] }): ReactNode {
  const decision = props.decisions[props.decisions.length - 1];
  const dims = new Map(props.dimensions.map((d) => [d.id, d]));
  return (
    <section className="max-h-[55%] shrink-0 overflow-y-auto rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <SectionTitle right={decision === undefined ? null : <DiscoveryCurve decision={decision} />}>
        Allocation{decision === undefined ? "" : ` → batch ${decision.batch} (${decision.decidedBy})`}
      </SectionTitle>
      {decision === undefined ? (
        <p className="text-slate-500">No allocation decision yet.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1">Dimension</th>
                <th className="px-2 text-right">z</th>
                <th className="px-2 text-right">NMI</th>
                <th className="pl-3">Levels (n · conflict)</th>
              </tr>
            </thead>
            <tbody>
              {[...decision.split]
                .sort((a, b) => b.z - a.z)
                .map((row) => {
                  const dim = dims.get(row.dimId);
                  const focus = decision.focusDimIds.includes(row.dimId);
                  return (
                    <tr key={row.dimId} className={`border-t border-slate-100 ${focus ? "bg-violet-50 font-semibold" : ""}`}>
                      <td className="py-1">
                        {focus && "★ "}
                        {dim?.name ?? row.dimId}
                      </td>
                      <td className="px-2 text-right font-mono">{row.z.toFixed(1)}</td>
                      <td className="px-2 text-right font-mono">{row.nmi.toFixed(2)}</td>
                      <td className="pl-3">
                        <div className="flex flex-wrap gap-1">
                          {row.byLevel.map((l) => (
                            <span key={l.levelId} className="rounded bg-slate-100 px-1.5 text-xs font-normal">
                              {dim?.levels.find((x) => x.id === l.levelId)?.label ?? l.levelId} · {l.n} · {pct(l.conflictShare)}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <p className="mt-2 text-sm text-slate-600">{decision.rationale}</p>
        </>
      )}
    </section>
  );
}
