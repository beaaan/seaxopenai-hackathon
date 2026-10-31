import type { ReactNode } from "react";
import type { Cluster } from "@shared/schema";
import type { RunView } from "../state";
import { pct, SectionTitle } from "../ui";

/** Sentinel for the "not in the text" pseudo-sentence (clusters with sentenceId null). */
export const NOT_IN_TEXT = "∅";

interface Heat {
  clusters: number;
  interpretations: number;
  conflictShare: number;
}

function heatBySentence(clusters: Cluster[]): Map<string, Heat> {
  const heat = new Map<string, Heat>();
  for (const c of clusters) {
    const key = c.sentenceId ?? NOT_IN_TEXT;
    const prev = heat.get(key) ?? { clusters: 0, interpretations: 0, conflictShare: 0 };
    const n = prev.interpretations + c.interpretationIds.length;
    heat.set(key, {
      clusters: prev.clusters + 1,
      interpretations: n,
      conflictShare: n === 0 ? 0 : (prev.conflictShare * prev.interpretations + c.conflictShare * c.interpretationIds.length) / n,
    });
  }
  return heat;
}

/** Hue runs amber (no conflict) → red (all conflict); saturation grows with cluster count. */
function tint(heat: Heat | undefined): string | undefined {
  if (heat === undefined) return undefined;
  const hue = 45 - 45 * heat.conflictShare;
  const lightness = 93 - 6 * Math.min(heat.clusters, 3);
  return `hsl(${hue} 90% ${lightness}%)`;
}

export function PolicyPane(props: {
  view: RunView;
  version: number | null;
  onVersion: (v: number) => void;
  sentenceId: string | null;
  onSentence: (id: string | null) => void;
}): ReactNode {
  const { view, version, sentenceId } = props;
  const versionNumbers = Object.keys(view.versions)
    .map(Number)
    .sort((a, b) => a - b);
  const policy = version === null ? undefined : view.versions[version];
  const heat = heatBySentence(version === null ? [] : (view.clusters[version] ?? []));
  const notInText = heat.get(NOT_IN_TEXT);

  return (
    <section className="flex min-h-0 flex-col rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <SectionTitle
        right={
          <div className="flex gap-1">
            {versionNumbers.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => props.onVersion(v)}
                className={`rounded px-3 py-1 text-sm font-semibold ${v === version ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
              >
                v{v}
              </button>
            ))}
          </div>
        }
      >
        Policy text
      </SectionTitle>
      {policy === undefined ? (
        <p className="text-slate-500">No policy version yet.</p>
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {policy.surfaces.map((surface) => (
            <div key={surface.id}>
              <div className="mb-1 text-xs font-semibold text-slate-500">{surface.label}</div>
              <div className="space-y-1">
                {policy.sentences
                  .filter((s) => s.surfaceId === surface.id)
                  .map((s) => {
                    const h = heat.get(s.id);
                    const selected = sentenceId === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => props.onSentence(selected ? null : s.id)}
                        style={{ backgroundColor: tint(h) }}
                        className={`block w-full rounded px-2 py-1 text-left text-[15px] leading-snug ${selected ? "ring-2 ring-indigo-600" : "hover:ring-1 hover:ring-slate-300"}`}
                        title={h === undefined ? s.id : `${s.id}: ${h.clusters} clusters, ${pct(h.conflictShare)} conflicting`}
                      >
                        <span className="mr-2 font-mono text-xs text-slate-400">{s.id}</span>
                        {s.text}
                        {h !== undefined && (
                          <span className="ml-2 rounded bg-white/70 px-1 font-mono text-xs text-slate-700">
                            {h.clusters}◎ {pct(h.conflictShare)}
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
          {notInText !== undefined && (
            <button
              type="button"
              onClick={() => props.onSentence(sentenceId === NOT_IN_TEXT ? null : NOT_IN_TEXT)}
              style={{ backgroundColor: tint(notInText) }}
              className={`block w-full rounded border border-dashed border-slate-400 px-2 py-1 text-left text-[15px] italic ${sentenceId === NOT_IN_TEXT ? "ring-2 ring-indigo-600" : ""}`}
            >
              Not in the text — {notInText.clusters}◎ {pct(notInText.conflictShare)}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
