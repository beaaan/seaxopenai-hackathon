import type { Finding, FolkVersion } from "@shared/schema";
import { cohortSize, misreadings, type RunModel } from "../model";

/** Where a group of readers ends up: one wrong idea, the rest, or none shared. */
export interface TunnelPool {
  id: string;
  label: string;
  kind: Finding["class"] | null;
  /** Streams drawn into this pool: readers for whom this is the most common wrong idea they hold. */
  readers: number;
  /** Everyone who holds it, including readers drawn into a more common pool. */
  holders: number;
  /** Of the streams drawn here, how many had been told each rumour (folk id), or nothing (null). */
  heard: Map<string | null, number>;
  role: "misreading" | "other" | "none";
}

/** Where a reader met the rule: the help article, only the checkout message, or no official text. */
export type Saw = "help" | "checkout" | "none";

export function sawOf(surfaceIds: readonly string[]): Saw {
  if (surfaceIds.length === 0) return "none";
  return surfaceIds.includes("help") ? "help" : "checkout";
}

export interface TunnelStream {
  scenarioId: string;
  /** The rumour this reader was told before reading, or null. */
  folkId: string | null;
  saw: Saw;
  pool: number;
}

export interface TunnelData {
  total: number;
  pools: TunnelPool[];
  streams: TunnelStream[];
  folk: Map<string, FolkVersion>;
}

/** The rumour itself, without the annotation some versions carry. */
export function shortClaim(f: FolkVersion): string {
  return f.claimEn.split(";")[0]!.replace(/\s*\([^)]*\)/g, "").replace(/\.$/, "").trim();
}

const SHOWN = 4;

/**
 * Each reader is one stream, drawn to the most common wrong idea they hold. The four most common destinations get
 * their own pool; other wrong ideas share one; readers with none another.
 */
export function tunnelData(m: RunModel, folk: readonly FolkVersion[]): TunnelData | null {
  if (m.scenarios.length === 0) return null;
  const rows = misreadings(m);
  const primary = new Map(m.scenarios.map((s) => [s.id, rows.findIndex((r) => r.readers.includes(s.id))]));
  const drawn = rows.filter((_, i) => [...primary.values()].includes(i)).slice(0, SHOWN);
  const pool = (p: Omit<TunnelPool, "readers" | "heard">): TunnelPool => ({ ...p, readers: 0, heard: new Map() });
  const otherIdeas = rows.length - drawn.length;
  const pools: TunnelPool[] = [
    ...drawn.map((r) => pool({ id: r.id, label: r.title, kind: r.kind, holders: r.readers.length, role: "misreading" })),
    pool({ id: "other", label: otherIdeas === 1 ? "1 other wrong idea" : `${otherIdeas} other wrong ideas`, kind: null, holders: 0, role: "other" }),
    pool({ id: "none", label: "No wrong idea shared with another reader", kind: null, holders: 0, role: "none" }),
  ];
  const streams: TunnelStream[] = m.scenarios.map((s) => {
    const first = primary.get(s.id) ?? -1;
    const shown = first < 0 ? -1 : drawn.indexOf(rows[first]!);
    return {
      scenarioId: s.id,
      folkId: s.exposure.folkVersionId,
      saw: sawOf(s.exposure.surfaceIds),
      pool: shown >= 0 ? shown : first >= 0 ? drawn.length : drawn.length + 1,
    };
  });
  for (const stream of streams) {
    const p = pools[stream.pool]!;
    p.readers++;
    p.heard.set(stream.folkId, (p.heard.get(stream.folkId) ?? 0) + 1);
  }
  // Keep pool indices dense: drop an empty "other" or "none" pool and renumber.
  const kept = pools.filter((p) => p.readers > 0);
  for (const stream of streams) stream.pool = kept.indexOf(pools[stream.pool]!);
  return { total: cohortSize(m), pools: kept, streams, folk: new Map(folk.map((f) => [f.id, f])) };
}
