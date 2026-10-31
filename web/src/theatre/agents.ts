import type { AllocationDecision, ThreadItemRecord } from "@shared/schema";

/** Short names for reader traits; anything else falls back to its id. */
const DIM_LABEL: Record<string, string> = {
  alternative_payment_access: "Payment options",
  account_usage_control: "Shared account",
  cod_delivery_history: "Delivery history",
  purchase_fulfillment_context: "What they buy",
  exposure_channel: "Where they read",
  prior_belief: "Rumour heard",
  attention: "Attention",
};

export function dimLabel(id: string): string {
  return DIM_LABEL[id] ?? id.replace(/_/g, " ");
}

export interface DimSignal {
  id: string;
  /** How strongly this trait splits the readings (z-score from the split table the agent reads). */
  z: number;
}

export interface ToolHit {
  key: number;
  tool: string;
  dimId: string | null;
  levelId: string | null;
}

export interface Reviewer {
  dims: DimSignal[];
  focus: string[];
  thinking: boolean;
  tool: ToolHit | null;
  decision: { key: number; batch: number; n: number; focus: string[]; stop: boolean; said: string } | null;
  /** New shared beliefs each finished batch turned up: the agent stops when this dries up. */
  discovery: Array<{ batch: number; newClusters: number }>;
}

export interface PersonaAction {
  key: number;
  tool: string;
  day: number | null;
}

export interface Persona {
  name: string;
  week: number;
  weeks: number;
  said: string | null;
  thinking: boolean;
  actions: PersonaAction[];
  codAvailable: boolean | null;
}

export interface Agents {
  active: "reviewer" | "persona" | null;
  reviewer: Reviewer | null;
  persona: Persona | null;
}

export function emptyAgents(): Agents {
  return { active: null, reviewer: null, persona: null };
}

function parse(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function splitSignals(split: unknown): DimSignal[] | null {
  if (!Array.isArray(split)) return null;
  const dims = split.flatMap((s): DimSignal[] => {
    const o = s as { dimId?: unknown; z?: unknown };
    return typeof o.dimId === "string" && typeof o.z === "number" ? [{ id: o.dimId, z: o.z }] : [];
  });
  return dims.length ? dims : null;
}

function reviewerOf(a: Agents): Reviewer {
  a.reviewer ??= { dims: [], focus: [], thinking: false, tool: null, decision: null, discovery: [] };
  return a.reviewer;
}

/** Fold one Codex thread item into the agents' picture. */
export function onThreadItem(a: Agents, r: ThreadItemRecord, key: number): void {
  const item = (r.item ?? {}) as Record<string, unknown>;
  if (r.role === "probe") {
    a.active = "persona";
    const p = (a.persona ??= { name: r.label, week: 0, weeks: 26, said: null, thinking: false, actions: [], codAvailable: null });
    p.thinking = r.itemType === "reasoning";
    if (r.itemType === "userMessage") {
      const first = Array.isArray(item.content) ? (item.content[0] as { text?: unknown } | undefined)?.text : undefined;
      const week = typeof first === "string" ? /(\d+)/.exec(first)?.[1] : undefined;
      if (week) p.week = Number(week);
      p.said = null;
    } else if (r.itemType === "agentMessage" && typeof item.text === "string") {
      p.said = item.text;
    } else if (r.itemType === "dynamicToolCall" && typeof item.tool === "string") {
      const contents = Array.isArray(item.contentItems) ? (item.contentItems[0] as { text?: unknown } | undefined)?.text : undefined;
      const result = parse(contents);
      if (result && typeof result.cod_available === "boolean") p.codAvailable = result.cod_available;
      p.actions = [...p.actions, { key, tool: item.tool, day: typeof result?.day === "number" ? result.day : null }];
    }
    return;
  }
  a.active = "reviewer";
  const rv = reviewerOf(a);
  rv.thinking = r.itemType === "reasoning";
  if (r.itemType === "dynamicToolCall" && typeof item.tool === "string") {
    const args = (item.arguments ?? {}) as Record<string, unknown>;
    rv.tool = { key, tool: item.tool, dimId: typeof args.dimId === "string" ? args.dimId : null, levelId: typeof args.levelId === "string" ? args.levelId : null };
    // The split table the agent just read: show it the same numbers.
    const contents = Array.isArray(item.contentItems) ? (item.contentItems[0] as { text?: unknown } | undefined)?.text : undefined;
    const dims = splitSignals(parse(contents)?.split);
    if (dims) rv.dims = dims;
  }
  if (r.itemType === "userMessage") rv.decision = null;
}

export function onAllocation(a: Agents, d: AllocationDecision, key: number): void {
  a.active = "reviewer";
  const rv = reviewerOf(a);
  rv.thinking = false;
  const dims = splitSignals(d.split);
  if (dims) rv.dims = dims;
  rv.focus = d.focusDimIds;
  rv.discovery = d.discovery.map((x) => ({ batch: x.batch, newClusters: x.newClusters }));
  rv.decision = { key, batch: d.batch, n: d.n, focus: d.focusDimIds, stop: d.stopExploring, said: d.rationale };
}
