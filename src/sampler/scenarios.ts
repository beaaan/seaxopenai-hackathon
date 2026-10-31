import { z } from "zod";
import { prompt } from "../core/prompts";
import { policyText, type StageContext } from "../pipeline/context";
import { Persona, Scenario, type Dimension, type Exposure, type LevelChoice, type PolicyVersion } from "../shared/schema";

const WrittenScenario = z.strictObject({
  persona: Persona,
  situationVi: z.string().min(1),
});

export interface WriteScenariosArgs {
  version: PolicyVersion;
  dimensions: Dimension[];
  rows: LevelChoice[][];
  batch: number;
  origin: Scenario["origin"];
  allocationReason: string | null;
  /** One-based index: firstIndex = 1 starts at s001. */
  firstIndex: number;
}

export async function writeScenarios(ctx: StageContext, args: WriteScenariosArgs): Promise<Scenario[]> {
  if (!Number.isInteger(args.firstIndex) || args.firstIndex < 1) throw new Error("firstIndex must be a positive integer");
  const dimensionById = new Map(args.dimensions.map((dimension) => [dimension.id, dimension]));
  if (dimensionById.size !== args.dimensions.length) throw new Error("Duplicate dimension ids");
  const surfaceIds = new Set(args.version.surfaces.map((surface) => surface.id));
  const folkIds = new Set(ctx.folk.versions.map((folk) => folk.id));
  const policy = policyText(args.version, { ids: false });
  const instructions = prompt("scenario");

  // Validate and set exposure before starting any calls, so a bad later row cannot spend a partial batch.
  const prepared = args.rows.map((row, offset) => {
    const levels = new Map<string, string>();
    const selected = row.map((choice) => {
      if (levels.has(choice.dimId)) throw new Error(`Duplicate choice for dimension ${choice.dimId}`);
      const dimension = dimensionById.get(choice.dimId);
      const level = dimension?.levels.find((candidate) => candidate.id === choice.levelId);
      if (!dimension || !level) throw new Error(`Unknown dimension/level: ${choice.dimId}/${choice.levelId}`);
      levels.set(choice.dimId, choice.levelId);
      return { dimension: dimension.name, dimensionId: dimension.id, levelId: level.id, label: level.label, description: level.description };
    });
    for (const dimension of args.dimensions) {
      if (!levels.has(dimension.id)) throw new Error(`Missing choice for dimension ${dimension.id}`);
    }
    const channel = levels.get("exposure_channel") ?? args.version.surfaces[0]?.id;
    if (!channel) throw new Error("Policy has no exposure surface");
    const prior = levels.get("prior_belief") ?? "none";
    if (prior !== "none" && !folkIds.has(prior)) throw new Error(`Unknown folk version: ${prior}`);
    const attention = levels.get("attention") ?? "careful";
    if (attention !== "skim" && attention !== "careful") throw new Error(`Unknown attention level: ${attention}`);
    let folkVersionId = prior === "none" ? null : prior;
    let exposedSurfaceIds: string[];
    if (channel === "friend") {
      folkVersionId ??= ctx.folk.versions[0]?.id ?? null;
      if (folkVersionId === null) throw new Error("Friend exposure requires a folk version");
      exposedSurfaceIds = [];
    } else {
      if (!surfaceIds.has(channel)) throw new Error(`Unknown exposure surface: ${channel}`);
      exposedSurfaceIds = [channel];
    }
    const exposure: Exposure = { surfaceIds: exposedSurfaceIds, folkVersionId, attention };
    return { row, selected, exposure, index: args.firstIndex + offset };
  });

  return Promise.all(prepared.map(async ({ row, selected, exposure, index }) => {
    const written = await ctx.gateway.structured({
      role: "scenario",
      instructions,
      input: JSON.stringify({
        policyTitle: ctx.policy.title,
        policy,
        selectedLevels: selected,
        exposure,
        folkTextVi: ctx.folk.versions.find((folk) => folk.id === exposure.folkVersionId)?.textVi ?? null,
        regionalVariationHint: ["miền Bắc", "miền Trung", "miền Nam"][(index - 1) % 3],
        scenarioIndex: index,
      }),
      schema: WrittenScenario,
      schemaName: "reader_scenario",
      model: ctx.config.models.reader,
      effort: "medium",
    });
    return Scenario.parse({
      id: `s${String(index).padStart(3, "0")}`,
      policyId: args.version.policyId,
      batch: args.batch,
      origin: args.origin,
      levels: row,
      persona: written.persona,
      exposure,
      situationVi: written.situationVi,
      allocationReason: args.allocationReason,
    });
  }));
}
