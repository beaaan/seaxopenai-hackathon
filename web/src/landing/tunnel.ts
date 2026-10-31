import type { Finding, FolkVersion, Sentence } from "@shared/schema";
import { cohortSize, misreadings, type RunModel } from "../model";

/** Where a group of readers ends up: one wrong idea, the rest, or none shared. */
export interface TunnelPool {
  id: string;
  label: string;
  kind: Finding["class"] | null;
  /** Index into `sentences` of the sentence behind it; null when the text never says it (or for "other"/"none"). */
  sentenceIndex: number | null;
  /** Streams drawn into this pool: readers for whom this is the most common wrong idea they hold. */
  readers: number;
  /** Everyone who holds it, including readers drawn into a more common pool. */
  holders: number;
  /** Of the streams drawn here, how many had been told each rumour (folk id), or nothing (null). */
  heard: Map<string | null, number>;
  role: "misreading" | "other" | "none";
}

export interface TunnelStream {
  scenarioId: string;
  /** The rumour this reader was told before reading, or null. */
  folkId: string | null;
  pool: number;
}

export interface TunnelData {
  total: number;
  sentences: Sentence[];
  pools: TunnelPool[];
  streams: TunnelStream[];
  folk: Map<string, FolkVersion>;
}

const SHOWN = 4;

/**
 * Each reader is one stream, drawn to the most common wrong idea they hold. The four most common destinations get
 * their own pool; other wrong ideas share one; readers with none another. Streams bend at the sentence behind their pool.
 */
export function tunnelData(m: RunModel, folk: readonly FolkVersion[]): TunnelData | null {
  const v0 = m.versions.find((v) => v.version === 0);
  if (!v0 || m.scenarios.length === 0) return null;
  const rows = misreadings(m);
  const primary = new Map(m.scenarios.map((s) => [s.id, rows.findIndex((r) => r.readers.includes(s.id))]));
  const drawn = rows.filter((_, i) => [...primary.values()].includes(i)).slice(0, SHOWN);
  const sentenceIndex = (ids: readonly string[]): number | null => {
    const i = v0.sentences.findIndex((s) => ids.includes(s.id));
    return i < 0 ? null : i;
  };
  const pool = (p: Omit<TunnelPool, "readers" | "heard">): TunnelPool => ({ ...p, readers: 0, heard: new Map() });
  const otherIdeas = rows.length - drawn.length;
  const pools: TunnelPool[] = [
    ...drawn.map((r) => pool({ id: r.id, label: r.title, kind: r.kind, sentenceIndex: sentenceIndex(r.sentenceIds), holders: r.readers.length, role: "misreading" })),
    pool({ id: "other", label: otherIdeas === 1 ? "1 other wrong idea" : `${otherIdeas} other wrong ideas`, kind: null, sentenceIndex: null, holders: 0, role: "other" }),
    pool({ id: "none", label: "No wrong idea shared with another reader", kind: null, sentenceIndex: null, holders: 0, role: "none" }),
  ];
  const streams: TunnelStream[] = m.scenarios.map((s) => {
    const first = primary.get(s.id) ?? -1;
    const shown = first < 0 ? -1 : drawn.indexOf(rows[first]!);
    return { scenarioId: s.id, folkId: s.exposure.folkVersionId, pool: shown >= 0 ? shown : first >= 0 ? drawn.length : drawn.length + 1 };
  });
  for (const stream of streams) {
    const p = pools[stream.pool]!;
    p.readers++;
    p.heard.set(stream.folkId, (p.heard.get(stream.folkId) ?? 0) + 1);
  }
  // Keep pool indices dense: drop an empty "other" or "none" pool and renumber.
  const kept = pools.filter((p) => p.readers > 0);
  for (const stream of streams) stream.pool = kept.indexOf(pools[stream.pool]!);
  // Lanes ordered by destination, rumour-told readers above those who heard nothing, so streams cross as little as possible.
  streams.sort((a, b) => a.pool - b.pool || Number(a.folkId === null) - Number(b.folkId === null));
  return { total: cohortSize(m), sentences: v0.sentences, pools: kept, streams, folk: new Map(folk.map((f) => [f.id, f])) };
}
