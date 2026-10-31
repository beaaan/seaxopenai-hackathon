import { z } from "zod";
import type { AgentThread, ToolDef } from "../core/llm/types";
import { prompt } from "../core/prompts";
import type { StageContext } from "../pipeline/context";
import { AllocationDecision, Level, type Cluster, type Dimension, type DiscoveryPoint, type LevelChoice, type Reading, type Scenario, type SplitRow } from "../shared/schema";

export interface ReviewerDecideArgs {
  batch: number;
  remainingBudget: number;
  batchSize: number;
  dimensions: Dimension[];
  split: SplitRow[];
  discovery: DiscoveryPoint[];
  clusters: Cluster[];
  readings: Reading[];
  scenarios: Scenario[];
}

export interface Reviewer {
  decide(args: ReviewerDecideArgs): Promise<AllocationDecision>;
  close(): Promise<void>;
}

const ReviewerOutput = z.strictObject({
  focusDimIds: z.array(z.string()),
  newLevels: z.array(z.strictObject({ dimId: z.string(), level: Level })),
  n: z.number().int().positive(),
  stopExploring: z.boolean(),
  rationale: z.string().trim().min(1),
});
const NoInput = z.strictObject({});
const ReadingFilter = z.strictObject({ dimId: z.string().nullable(), levelId: z.string().nullable() });

function fallbackDecision(args: ReviewerDecideArgs, reason: string): AllocationDecision {
  const dimensions = new Set(args.dimensions.map((dimension) => dimension.id));
  const ranked = args.split.filter((row) => dimensions.has(row.dimId) && Number.isFinite(row.z)).sort((a, b) => b.z - a.z);
  const strong = ranked.filter((row) => row.z > 1).slice(0, 2);
  const focusDimIds = (strong.length > 0 ? strong : ranked.slice(0, 1)).map((row) => row.dimId);
  if (focusDimIds.length === 0 && args.dimensions[0]) focusDimIds.push(args.dimensions[0].id);
  const n = Math.max(0, Math.floor(Math.min(args.batchSize, args.remainingBudget)));
  const saturated = args.discovery.length >= 2 && args.discovery.slice(-2).every((point) => point.newClusters === 0);
  return {
    batch: args.batch,
    split: args.split,
    discovery: args.discovery,
    focusDimIds,
    newLevels: [],
    n,
    stopExploring: n === 0 || saturated,
    rationale: `Reviewer unavailable or invalid: ${reason}. Focus on the top two dimensions with z > 1, or the highest-z dimension if none qualify; reserve 20% random coverage. ${n === 0 ? "No sampling budget remains." : saturated ? "The last two batches discovered no new clusters." : "Discovery has not saturated."}`,
    decidedBy: "fallback",
  };
}

export async function createReviewer(ctx: StageContext): Promise<Reviewer> {
  let latest: ReviewerDecideArgs | null = null;
  let thread: AgentThread | null = null;
  let threadError = "Reviewer thread did not start";
  const tools: ToolDef[] = [
    {
      name: "get_split_table",
      description: "Inspect the latest dimension split statistics, level conflict shares, discovery curve, and dimension definitions.",
      input: NoInput,
      handler: async (input) => {
        NoInput.parse(input);
        if (!latest) throw new Error("No batch has been submitted for review");
        return { split: latest.split, discovery: latest.discovery, dimensions: latest.dimensions };
      },
    },
    {
      name: "get_clusters",
      description: "Inspect the latest belief cluster labels, distinct-reader sizes, conflict shares, and up to three sample English glosses per cluster.",
      input: NoInput,
      handler: async (input) => {
        NoInput.parse(input);
        if (!latest) throw new Error("No batch has been submitted for review");
        const interpretations = new Map(latest.readings.flatMap((reading) => reading.interpretations.map((interpretation) => [interpretation.id, interpretation.glossEn] as const)));
        return latest.clusters.map((cluster) => ({
          id: cluster.id,
          labelVi: cluster.labelVi,
          labelEn: cluster.labelEn,
          size: new Set(cluster.readingIds).size,
          conflictShare: cluster.conflictShare,
          sampleGlosses: cluster.interpretationIds.flatMap((id) => {
            const gloss = interpretations.get(id);
            return gloss === undefined ? [] : [gloss];
          }).slice(0, 3),
        }));
      },
    },
    {
      name: "get_readings",
      description: "Inspect paraphrases, intended actions, persona summaries, and exposure. Set dimId and levelId to filter; use null for no filter.",
      input: ReadingFilter,
      handler: async (input) => {
        const filter = ReadingFilter.parse(input);
        if (!latest) throw new Error("No batch has been submitted for review");
        if (filter.levelId !== null && filter.dimId === null) throw new Error("levelId requires dimId");
        if (filter.dimId !== null && !latest.dimensions.some((dimension) => dimension.id === filter.dimId)) throw new Error(`Unknown dimension: ${filter.dimId}`);
        const scenarios = new Map(latest.scenarios.map((scenario) => [scenario.id, scenario]));
        return latest.readings.flatMap((reading) => {
          const scenario = scenarios.get(reading.scenarioId);
          if (filter.dimId !== null && !scenario?.levels.some((choice) => choice.dimId === filter.dimId && (filter.levelId === null || choice.levelId === filter.levelId))) return [];
          return [{
            id: reading.id,
            scenarioId: reading.scenarioId,
            levels: scenario?.levels ?? [],
            persona: scenario ? `${scenario.persona.name}, ${scenario.persona.age}, ${scenario.persona.province}; ${scenario.persona.occupation}; literacy ${scenario.persona.literacy}` : null,
            exposure: scenario?.exposure ?? null,
            paraphraseVi: reading.paraphraseVi,
            actions: reading.actions,
          }];
        });
      },
    },
  ];
  try {
    thread = await ctx.gateway.agentThread({
      role: "reviewer",
      label: "Reviewer",
      persist: true,
      model: ctx.config.models.reviewer,
      effort: "high",
      instructions: prompt("reviewer"),
      tools,
      onItem: (item) => ctx.emitThreadItem(item),
    });
  } catch (error) {
    threadError = error instanceof Error ? error.message : String(error);
    ctx.log("warn", `Reviewer thread failed: ${threadError}`);
  }
  return {
    async decide(args) {
      latest = args;
      const maximum = Math.max(0, Math.floor(Math.min(args.batchSize, args.remainingBudget)));
      if (maximum === 0) return fallbackDecision(args, "No sampling budget remains");
      if (!thread) return fallbackDecision(args, threadError);
      try {
        const result = await thread.turn(JSON.stringify({
          task: "Allocate the next exploration batch. Inspect the latest evidence with the tools before deciding. Only the output-schema fields are model-authored; batch, split and discovery are filled by code.",
          batch: args.batch,
          remainingBudget: args.remainingBudget,
          batchSize: args.batchSize,
          maximumN: maximum,
          dimensions: args.dimensions,
          split: args.split,
          discovery: args.discovery,
          clusterCount: args.clusters.length,
          readingCount: args.readings.length,
        }), { schema: ReviewerOutput, name: "reviewer_allocation" });
        const output = ReviewerOutput.parse(JSON.parse(result.finalText) as unknown);
        const dimensions = new Set(args.dimensions.map((dimension) => dimension.id));
        if (output.focusDimIds.some((id) => !dimensions.has(id))) throw new Error("Unknown focus dimension");
        if (new Set(output.focusDimIds).size !== output.focusDimIds.length) throw new Error("Duplicate focus dimensions");
        const levelIds = new Set(args.dimensions.flatMap((dimension) => dimension.levels.map((level) => level.id)));
        for (const addition of output.newLevels) {
          if (!dimensions.has(addition.dimId)) throw new Error(`Unknown new-level dimension: ${addition.dimId}`);
          if (addition.dimId === "exposure_channel" || addition.dimId === "prior_belief" || addition.dimId === "attention") throw new Error(`Cannot add levels to built-in exposure dimension: ${addition.dimId}`);
          if (!addition.level.id.trim() || levelIds.has(addition.level.id)) throw new Error(`Duplicate or empty new level id: ${addition.level.id}`);
          levelIds.add(addition.level.id);
        }
        return AllocationDecision.parse({
          ...output,
          n: Math.min(maximum, output.n),
          batch: args.batch,
          split: args.split,
          discovery: args.discovery,
          decidedBy: "reviewer",
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        ctx.log("warn", `Reviewer allocation failed: ${reason}`);
        return fallbackDecision(args, reason);
      }
    },
    async close() {
      await thread?.close();
    },
  };
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function rowsForDecision(dimensions: Dimension[], decision: AllocationDecision, seed: number): LevelChoice[][] {
  if (!Number.isInteger(decision.n) || decision.n < 0) throw new Error("Allocation size must be a nonnegative integer");
  const expanded = dimensions.map((dimension) => {
    const levels = [...dimension.levels];
    for (const addition of decision.newLevels) {
      if (addition.dimId === dimension.id && !levels.some((level) => level.id === addition.level.id)) levels.push(addition.level);
    }
    if (levels.length === 0) throw new Error(`Dimension ${dimension.id} has no levels`);
    return { id: dimension.id, levels };
  });
  const focus = [...new Set(decision.focusDimIds)].flatMap((id) => {
    const dimension = expanded.find((item) => item.id === id);
    return dimension ? [dimension] : [];
  });
  const random = mulberry32(seed);
  const randomCount = Math.ceil(0.2 * decision.n);
  const rows: LevelChoice[][] = [];
  for (let i = 0; i < decision.n; i++) {
    const focusedIndex = i - randomCount;
    const target = focusedIndex >= 0 && focus.length > 0 ? focus[focusedIndex % focus.length] : undefined;
    const cycle = focus.length === 0 ? 0 : Math.floor(focusedIndex / focus.length);
    rows.push(expanded.map((dimension) => {
      const levelIndex = target?.id === dimension.id ? cycle % dimension.levels.length : Math.floor(random() * dimension.levels.length);
      const level = dimension.levels[levelIndex];
      if (!level) throw new Error(`No level at index ${levelIndex} for ${dimension.id}`);
      return { dimId: dimension.id, levelId: level.id };
    }));
  }
  return rows;
}
