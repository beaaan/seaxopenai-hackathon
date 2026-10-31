import type { ReactNode } from "react";
import { Check, Minus } from "lucide-react";
import { originalReadings } from "../model";
import type { RunContext } from "../pages/RunPage";
import { Card, Empty, Section, cx, pct } from "../ui";

export function Benchmark(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const score = model.score;
  const replicates = model.baselines.filter((b) => /^baseline-\d+$/.test(b.id)).length;
  const cost = (systemId: string): string => {
    if (systemId === "wind-tunnel") return `${originalReadings(model).length} persona readings`;
    if (systemId === "baseline-mean" || systemId === "baseline-union") return `${replicates} single-pass runs`;
    return "1 call";
  };
  const edgeCases = score ? [...new Set(score.matches.map((m) => m.edgeCaseId))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))) : [];
  const unmatched = score?.outsideReference.filter((o) => o.systemId === "wind-tunnel").length ?? 0;

  return (
    <Section id="benchmark" kicker="Benchmark" title="Against a single careful model reading the same text">
      {!score ? (
        <Empty>
          {model.baselines.length > 0 ? `${model.baselines.length} baseline runs recorded; ` : ""}
          scoring needs the team's holdout edge cases (written by a human, never shown to the pipeline).
        </Empty>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
          <Card className="p-6">
            <div className="text-sm font-semibold text-stone-900">Recall on {edgeCases.length} holdout edge cases</div>
            <div className="mt-1 text-xs text-stone-500">Scored blind: items are anonymised and shuffled before a separate model decides matches.</div>
            <div className="mt-5 space-y-4">
              {[...score.systems].sort((a, b) => b.recall - a.recall).map((s) => (
                <div key={s.id}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className={cx(s.id === "wind-tunnel" ? "font-semibold text-stone-900" : "text-stone-700")}>{s.id === "wind-tunnel" ? "Policy Wind Tunnel" : s.label}</span>
                    <span className="tabular-nums font-semibold">{pct(s.recall)}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-stone-100"><div className={cx("h-2 rounded-full", s.id === "wind-tunnel" ? "bg-indigo-600" : "bg-stone-400")} style={{ width: `${Math.max(1, s.recall * 100)}%` }} /></div>
                  <div className="mt-0.5 text-xs text-stone-400">{cost(s.id)}</div>
                </div>
              ))}
            </div>
            {unmatched > 0 && <p className="mt-5 text-sm text-stone-600">{unmatched} Wind Tunnel finding{unmatched > 1 ? "s" : ""} matched no holdout case: not validated, not disproved — see the human check.</p>}
          </Card>
          <Card className="overflow-x-auto p-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                  <th className="py-2 font-medium">Edge case</th>
                  {score.systems.map((s) => <th key={s.id} className="px-2 py-2 text-center font-medium">{s.id === "wind-tunnel" ? "Wind Tunnel" : s.id.replace("baseline-", "")}</th>)}
                </tr>
              </thead>
              <tbody>
                {edgeCases.map((edge) => (
                  <tr key={edge} className="border-b border-stone-100 last:border-0">
                    <td className="py-2 font-mono text-xs text-stone-600">{edge}</td>
                    {score.systems.map((s) => {
                      const m = score.matches.find((x) => x.edgeCaseId === edge && x.systemId === s.id);
                      return <td key={s.id} className="px-2 py-2 text-center" title={m?.why}>{m?.matched ? <Check size={16} className="mx-auto text-emerald-600" /> : <Minus size={16} className="mx-auto text-stone-300" />}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </Section>
  );
}
