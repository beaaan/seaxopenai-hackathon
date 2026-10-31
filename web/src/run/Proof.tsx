import { useState, type ReactNode } from "react";
import { BadgeCheck, Check } from "lucide-react";
import type { Iteration } from "@shared/schema";
import { api } from "../api";
import { acceptedRewrite, finalVersion, hasReference } from "../model";
import type { RunContext } from "../pages/RunPage";
import { Badge, Button, Card, Empty, Section, cx, pct } from "../ui";

export function Proof(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const its = model.iterations;
  const reference = hasReference(model);
  const final = finalVersion(model);
  const titles = new Map(model.findings.map((f) => [f.id, f.title]));
  const accepted = model.versions.filter((v) => v.version > 0).map((v) => ({
    version: v.version,
    rewrite: acceptedRewrite(model, v.version),
    rejected: model.rewrites.filter((r) => r.toVersion === v.version && !r.fidelity.passed).length,
  }));

  return (
    <Section id="proof" kicker="Rewrite & proof" title="Did the rewrite actually change what people understand?">
      {its.length === 0 ? <Empty>The loop measures v0 twice, rewrites, and re-reads the same scenarios. Nothing measured yet.</Empty> : (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <Card className="p-6">
              <div className="text-sm font-semibold text-stone-900">Conflict rate by version</div>
              <div className="mt-1 text-xs text-stone-500">Share of readings with an interpretation that contradicts a reference fact · 95% CI · grey band = test–retest noise of the original</div>
              {reference ? <ConflictChart iterations={its} /> : (
                <div className="mt-6 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">No reference facts were loaded, so interpretations are not graded. Change is measured on the frozen belief codebook instead (right).</div>
              )}
              <div className="mt-4 rounded-xl bg-stone-50 px-4 py-3 text-sm text-stone-700">
                <span className="font-semibold text-stone-900">Stop rule: </span>{model.stop?.reason ?? its.at(-1)?.reason}
              </div>
            </Card>
            <Card className="overflow-x-auto p-6">
              <div className="text-sm font-semibold text-stone-900">Readers holding each finding's belief</div>
              <div className="mt-1 text-xs text-stone-500">Same scenarios, same frozen codebook. ± is that finding's own test–retest noise; a change only counts beyond it.</div>
              <table className="mt-4 w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                    <th className="py-2 font-medium">Finding</th>
                    {its.map((it, i) => <th key={i} className="py-2 text-right font-medium">v{it.policyVersion}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {(its[0]?.findingReproduction ?? []).map((row) => (
                    <tr key={row.findingId} className="border-b border-stone-100 last:border-0">
                      <td className="py-2 pr-3 text-stone-800">{titles.get(row.findingId) ?? row.findingId}</td>
                      {its.map((it, i) => {
                        const cell = it.findingReproduction.find((r) => r.findingId === row.findingId);
                        if (!cell || cell.n === 0) return <td key={i} className="py-2 text-right text-stone-400">—</td>;
                        const delta = i === 0 ? 0 : cell.rate - row.rate;
                        const beyond = i > 0 && row.noiseBand !== null && Math.abs(delta) > row.noiseBand;
                        return (
                          <td key={i} className={cx("py-2 text-right tabular-nums", beyond && (delta < 0 ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"))}>
                            {pct(cell.rate)}
                            {i === 0 && <span className="ml-1 text-xs text-stone-400">{cell.noiseBand === null ? "· no noise est." : `±${(cell.noiseBand * 100).toFixed(0)}`}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          {accepted.length > 0 ? accepted.map(({ version, rewrite, rejected }) => (
            <Card key={version} className="p-6">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold text-stone-900">v{version - 1} → v{version}</div>
                {rewrite && <Badge tone="good"><Check size={12} /> fidelity passed</Badge>}
                {rejected > 0 && <Badge tone="warn">{rejected} attempt{rejected > 1 ? "s" : ""} rejected by fidelity</Badge>}
                {version === final ? <Badge tone="accent">kept</Badge> : <Badge tone="bad">rolled back</Badge>}
              </div>
              <div className="mt-4 space-y-3">
                {rewrite?.edits.map((edit, i) => (
                  <div key={i} className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-stone-800">{edit.before || <i className="text-stone-400">(new sentence)</i>}</div>
                    <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-stone-900">
                      {edit.after}
                      <div className="mt-1 text-xs text-stone-500">fixes {edit.findingIds.map((id) => titles.get(id) ?? id).join("; ")}</div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )) : (
            <Card className="p-6 text-sm text-stone-600">No rewrite was accepted{model.findings.some((f) => f.class === "wording_fix") ? "" : ": none of the findings can be fixed by wording alone"}.</Card>
          )}
          <Approve ctx={props.ctx} />
        </div>
      )}
    </Section>
  );
}

function Approve(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const final = finalVersion(model);
  const approved = model.approvals.find((a) => a.version === final);
  const [state, setState] = useState<"idle" | "busy" | "done" | string>("idle");
  if (model.status !== "completed" || final === 0) return null;
  if (approved || state === "done") return <div className="flex items-center gap-2 text-sm text-emerald-700"><BadgeCheck size={16} /> v{final} approved{approved ? ` by ${approved.approvedBy}` : ""}. It becomes the base for policy CI.</div>;
  return (
    <div className="flex items-center gap-3">
      <Button
        disabled={state === "busy"}
        onClick={() => {
          setState("busy");
          api.approve(model.runId, final, "PM").then(() => setState("done"), (err: unknown) => setState(String(err)));
        }}
      >
        <BadgeCheck size={16} /> Approve v{final}
      </Button>
      {state !== "idle" && state !== "busy" && <span className="text-sm text-rose-700">{state}</span>}
    </div>
  );
}

function ConflictChart(props: { iterations: Iteration[] }): ReactNode {
  const its = props.iterations;
  const W = 420;
  const H = 200;
  const pad = { l: 40, r: 16, t: 16, b: 28 };
  const maxY = Math.min(1, Math.max(0.2, ...its.map((it) => it.ci95.hi)) * 1.15);
  const x = (i: number): number => pad.l + (its.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (its.length - 1));
  const y = (v: number): number => pad.t + (1 - v / maxY) * (H - pad.t - pad.b);
  const base = its[0]!;
  const band = base.noiseBand ?? 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-4 w-full">
      {[0, 0.25, 0.5, 0.75, 1].filter((v) => v <= maxY).map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="#e7e5e4" />
          <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#a8a29e">{pct(v)}</text>
        </g>
      ))}
      {band > 0 && <rect x={pad.l} width={W - pad.l - pad.r} y={y(Math.min(maxY, base.conflictRate + band))} height={y(Math.max(0, base.conflictRate - band)) - y(Math.min(maxY, base.conflictRate + band))} fill="#d6d3d1" opacity="0.5" />}
      <polyline points={its.map((it, i) => `${x(i)},${y(it.conflictRate)}`).join(" ")} fill="none" stroke="#4f46e5" strokeWidth="2" />
      {its.map((it, i) => (
        <g key={i}>
          <line x1={x(i)} x2={x(i)} y1={y(it.ci95.lo)} y2={y(it.ci95.hi)} stroke="#4f46e5" strokeWidth="1.5" opacity="0.5" />
          <circle cx={x(i)} cy={y(it.conflictRate)} r="5" fill="#4f46e5" />
          <text x={x(i)} y={y(it.conflictRate) - 10} textAnchor="middle" fontSize="11" fontWeight="600" fill="#1c1917">{pct(it.conflictRate)}</text>
          <text x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#57534e">v{it.policyVersion}</text>
        </g>
      ))}
    </svg>
  );
}
