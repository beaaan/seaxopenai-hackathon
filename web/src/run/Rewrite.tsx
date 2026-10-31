import { useState, type ReactNode } from "react";
import { BadgeCheck } from "lucide-react";
import type { Iteration } from "@shared/schema";
import { beyondNoise } from "@shared/noise";
import { api } from "../api";
import { acceptedRewrite, finalVersion, hasReference } from "../model";
import type { RunContext } from "../pages/RunPage";
import { Empty, Kpis, Panel, Pill, TitleRow, band, cx, errorText, pct, type KpiItem } from "../ui";

export function Rewrite(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const its = model.iterations;
  const reference = hasReference(model);
  const final = finalVersion(model);
  const titles = new Map(model.findings.map((f) => [f.id, f.title]));
  const versions = model.versions.filter((v) => v.version > 0).map((v) => ({
    version: v.version,
    rewrite: acceptedRewrite(model, v.version),
    rejected: model.rewrites.filter((r) => r.toVersion === v.version && !r.fidelity.passed).length,
  }));
  const rejectedTotal = model.rewrites.filter((r) => !r.fidelity.passed).length;
  const first = its[0] ?? null;
  const last = its.findLast((it) => it.policyVersion === final && it !== first) ?? null;
  const fell = first && last ? first.findingReproduction.filter((row) => {
    const after = last.findingReproduction.find((r) => r.findingId === row.findingId);
    return after !== undefined && after.n > 0 && row.n > 0 && row.noiseBand !== null && row.rate > after.rate && beyondNoise(row.rate - after.rate, row.noiseBand);
  }).length : 0;

  const kpis: KpiItem[] = [
    { label: "Rewrites kept", value: final, delta: final === 0 ? "the original text stands" : `original → version ${final}` },
    { label: "Rewrites rejected", value: rejectedTotal, delta: "they changed a rule or dropped a fact" },
    { label: "Misreadings that fell", value: fell, delta: last ? "by more than normal variation" : "needs a rewrite to be read again" },
  ];
  if (reference && first) kpis.push({ label: "Readings that contradict the policy", value: last ? <>{pct(first.conflictRate)} → {pct(last.conflictRate)}</> : pct(first.conflictRate), delta: first.noiseBand !== null ? `normal variation ${band(first.noiseBand)}` : "variation not measured" });
  else kpis.push({ label: "Readers who read it twice", value: first?.noiseBandScenarios ?? <span className="dash">–</span>, delta: "to measure normal variation" });

  return (
    <>
      <TitleRow
        title="Fixing the wording"
        sub={final > 0 ? "A rewrite was kept. Fewer of the same readers misread it, and no rule changed." : model.findings.some((f) => f.class === "wording_fix") ? "No rewrite beat normal variation without changing a rule." : "No misreading here can be fixed by rewording."}
        actions={<Approve ctx={props.ctx} />}
      />
      {its.length === 0 ? <Empty>Nothing measured yet.</Empty> : (
        <>
          <Kpis items={kpis} />
          <div className="grid">
            <div className={reference ? "c7" : "c12"}>
              <Panel flush title="Share of readers holding each misreading" meta="same readers, each version">
                <div className="table-wrap" style={{ marginTop: 4 }}>
                  <table>
                    <thead>
                      <tr><th>Misreading</th>{its.map((it, i) => <th key={i} className="n">{it.policyVersion === 0 ? "Original" : `Version ${it.policyVersion}`}{i === 0 ? "" : " "}</th>)}<th className="n">Normal variation</th></tr>
                    </thead>
                    <tbody>
                      {(first?.findingReproduction ?? []).map((row) => (
                        <tr key={row.findingId}>
                          <td>{titles.get(row.findingId) ?? row.findingId}</td>
                          {its.map((it, i) => {
                            const cell = it.findingReproduction.find((r) => r.findingId === row.findingId);
                            if (!cell || cell.n === 0) return <td key={i} className="n dash">–</td>;
                            const delta = cell.rate - row.rate;
                            const beyond = i > 0 && row.noiseBand !== null && beyondNoise(delta, row.noiseBand);
                            return <td key={i} className={cx("n", beyond && (delta < 0 ? "good" : "bad"))}>{pct(cell.rate)}<span className="muted small"> n={cell.n}</span></td>;
                          })}
                          <td className="n muted">{row.noiseBand === null ? "not measured" : band(row.noiseBand)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
            {reference && (
              <div className="c5">
                <Panel title="Readings that contradict the policy" meta="95% range · grey: normal variation">
                  <ConflictChart iterations={its} />
                </Panel>
              </div>
            )}
          </div>
          {versions.length > 0 && <div className="stack" style={{ marginTop: "var(--gap)" }}>
            {versions.map(({ version, rewrite, rejected }) => (
              <Panel key={version} title={`${version === 1 ? "Original" : `Version ${version - 1}`} → version ${version}`} meta={<span className="pills" style={{ justifyContent: "flex-end" }}>
                {rewrite && <Pill tone="pos">No rule changed</Pill>}
                {rejected > 0 && <Pill tone="warn">{rejected} attempt{rejected > 1 ? "s" : ""} rejected</Pill>}
                {version === final ? <Pill tone="accent">Kept</Pill> : <Pill tone="neg">Rolled back</Pill>}
              </span>}>
                <div className="stack" style={{ gap: 12 }}>
                  {rewrite?.edits.map((edit, i) => (
                    <div key={i}>
                      <div className="diff">
                        <div className="before"><span className="label">Before</span>{edit.before || "(new sentence)"}</div>
                        <div className="after"><span className="label">After</span>{edit.after}</div>
                      </div>
                      <div className="small muted" style={{ marginTop: 4 }}>Targets: {edit.findingIds.map((id) => titles.get(id) ?? id).join("; ")}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            ))}
          </div>}
        </>
      )}
    </>
  );
}

function Approve(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const final = finalVersion(model);
  const approved = model.approvals.find((a) => a.version === final);
  const [state, setState] = useState<"idle" | "busy" | "done" | { error: string }>("idle");
  if (model.status !== "completed" || final === 0) return null;
  if (approved || state === "done") return <span className="live"><BadgeCheck size={15} className="good" /> v{final} approved{approved ? ` by ${approved.approvedBy}` : ""}</span>;
  return (
    <>
      {typeof state === "object" && <span className="small bad">{state.error}</span>}
      <button
        className="btn primary"
        disabled={state === "busy"}
        onClick={() => {
          setState("busy");
          api.approve(model.runId, final, "PM").then(() => setState("done"), (err: unknown) => setState({ error: errorText(err) }));
        }}
      >
        <BadgeCheck /> Approve v{final}
      </button>
    </>
  );
}

function ConflictChart(props: { iterations: Iteration[] }): ReactNode {
  const its = props.iterations;
  const W = 440;
  const H = 200;
  const pad = { l: 40, r: 16, t: 20, b: 26 };
  const top = Math.max(...its.map((it) => it.ci95.hi), 0.05);
  const step = top <= 0.1 ? 0.025 : top <= 0.2 ? 0.05 : top <= 0.5 ? 0.1 : 0.25;
  const maxY = Math.min(1, Math.ceil((top + 1e-9) / step) * step + (top >= 1 ? 0 : step));
  const ticks = Array.from({ length: Math.round(maxY / step) + 1 }, (_, i) => i * step);
  const x = (i: number): number => pad.l + (its.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (its.length - 1));
  const y = (v: number): number => pad.t + (1 - v / maxY) * (H - pad.t - pad.b);
  const base = its[0]!;
  const noise = base.noiseBand ?? 0;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%" }} role="img" aria-label="Conflict rate by version">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--control)" : "var(--rule)"} />
          <text x={pad.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{Math.round(v * 100)}%</text>
        </g>
      ))}
      {noise > 0 && <rect x={pad.l} width={W - pad.l - pad.r} y={y(Math.min(maxY, base.conflictRate + noise))} height={y(Math.max(0, base.conflictRate - noise)) - y(Math.min(maxY, base.conflictRate + noise))} fill="var(--chart-band)" opacity="0.45" />}
      <polyline points={its.map((it, i) => `${x(i)},${y(it.conflictRate)}`).join(" ")} fill="none" stroke="var(--chart-1)" strokeWidth="2" />
      {its.map((it, i) => (
        <g key={i}>
          <line x1={x(i)} x2={x(i)} y1={y(it.ci95.lo)} y2={y(it.ci95.hi)} stroke="var(--chart-1)" strokeWidth="1" opacity="0.6" />
          <circle cx={x(i)} cy={y(it.conflictRate)} r="3.5" fill="var(--chart-1)" />
          <text x={x(i)} y={y(it.conflictRate) - 9} textAnchor="middle" fontSize="12" fontWeight="500" fill="var(--text)">{pct(it.conflictRate)}</text>
          <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">v{it.policyVersion}</text>
        </g>
      ))}
    </svg>
  );
}
