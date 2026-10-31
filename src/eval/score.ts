import { z } from "zod";
import { prompt } from "../core/prompts";
import { policyText, type StageContext } from "../pipeline/context";
import type { PolicyVersion, Score, ScoreMatch } from "../shared/schema";
import { loadHoldout } from "./holdout";

const MatchResult = z.strictObject({
  matched: z.boolean(),
  itemNumber: z.number().int().positive().nullable(),
  why: z.string(),
});

export interface ScoringSystem {
  id: string;
  label: string;
  items: Array<{ id: string; text: string }>;
}

export interface ScoreArgs {
  version: PolicyVersion;
  seed: number;
  systems: ScoringSystem[];
}

/** Adds summary rows without mutating scores or treating previous summaries as replicates. */
export function aggregateBaselines(score: Score): Score {
  const systems = score.systems.filter((system) => system.id !== "baseline-mean" && system.id !== "baseline-union");
  const baselines = systems.filter((system) => system.id.startsWith("baseline-"));
  if (baselines.length === 0) return { ...score, systems };
  const baselineIds = new Set(baselines.map((system) => system.id));
  const edgeCases = new Set(score.matches.map((match) => match.edgeCaseId));
  const matched = new Set(score.matches.filter((match) => baselineIds.has(match.systemId) && match.matched).map((match) => match.edgeCaseId));
  return {
    ...score,
    systems: [
      ...systems,
      { id: "baseline-mean", label: "Baseline mean", recall: baselines.reduce((sum, system) => sum + system.recall, 0) / baselines.length },
      { id: "baseline-union", label: "Baseline union", recall: edgeCases.size === 0 ? 0 : matched.size / edgeCases.size },
    ],
  };
}

export async function scoreAgainstHoldout(ctx: StageContext, args: ScoreArgs): Promise<Score | null> {
  const holdout = loadHoldout(ctx.policy.id);
  if (holdout === null) return null;
  let state = args.seed >>> 0;
  const anonymousSystems = args.systems.map((system) => {
    const items = [...system.items];
    for (let index = items.length - 1; index > 0; index--) {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      const other = Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * (index + 1));
      [items[index], items[other]] = [items[other]!, items[index]!];
    }
    return { system, items };
  });
  const policy = policyText(args.version, { ids: true });
  const instructions = prompt("scorer");
  const matches = await Promise.all(holdout.edgeCases.flatMap((edgeCase) => anonymousSystems.map(async ({ system, items }): Promise<ScoreMatch> => {
    const result = await ctx.gateway.structured({
      role: "scorer",
      instructions,
      input: JSON.stringify({
        policy,
        edgeCase: { description: edgeCase.description, sentenceIds: edgeCase.sentenceIds },
        system: "System X",
        items: items.map((item, index) => ({ itemNumber: index + 1, text: item.text })),
      }),
      schema: MatchResult,
      schemaName: "blind_match",
      model: ctx.config.models.judge,
      effort: "high",
      fresh: ctx.config.fresh,
    });
    const item = result.itemNumber === null ? undefined : items[result.itemNumber - 1];
    if ((result.matched && !item) || (!result.matched && result.itemNumber !== null)) {
      throw new Error(`scorer returned inconsistent match for edge case ${edgeCase.id}`);
    }
    return { edgeCaseId: edgeCase.id, systemId: system.id, matched: result.matched, itemId: item?.id ?? null, why: result.why };
  })));
  const matchedItemIds = new Set(matches.filter((match) => match.systemId === "wind-tunnel" && match.matched && match.itemId !== null).map((match) => match.itemId));
  return aggregateBaselines({
    systems: args.systems.map((system) => ({
      id: system.id,
      label: system.label,
      recall: holdout.edgeCases.length === 0 ? 0 : matches.filter((match) => match.systemId === system.id && match.matched).length / holdout.edgeCases.length,
    })),
    matches,
    // Historical schema name: these items are unmatched by holdout, not necessarily outside reference facts.
    outsideReference: args.systems.filter((system) => system.id === "wind-tunnel").flatMap((system) => system.items.filter((item) => !matchedItemIds.has(item.id)).map((item) => ({ systemId: system.id, itemId: item.id }))),
  });
}
