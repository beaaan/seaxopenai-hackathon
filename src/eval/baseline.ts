import { z } from "zod";
import type { Effort } from "../core/llm/types";
import { prompt } from "../core/prompts";
import { policyText, referenceText, type StageContext } from "../pipeline/context";
import type { BaselineRun, PolicyVersion } from "../shared/schema";

const BaselineReview = z.strictObject({
  issues: z.array(z.strictObject({ sentenceQuote: z.string(), issue: z.string(), why: z.string() })),
});

export async function runBaseline(ctx: StageContext, version: PolicyVersion, opts: { id: string; model: string; effort: Effort }): Promise<BaselineRun> {
  const review = await ctx.gateway.structured({
    role: "baseline",
    instructions: prompt("baseline"),
    input: `VĂN BẢN CHÍNH SÁCH:\n${policyText(version, { ids: false })}\n\nDỮ KIỆN THAM CHIẾU:\n${referenceText(ctx.reference)}`,
    schema: BaselineReview,
    schemaName: "baseline_review",
    model: opts.model,
    effort: opts.effort,
    replicate: opts.id,
    fresh: ctx.config.fresh,
  });
  return {
    id: opts.id,
    model: opts.model,
    effort: opts.effort,
    issues: review.issues.map((issue, index) => ({ id: `${opts.id}-i${index + 1}`, ...issue })),
  };
}
