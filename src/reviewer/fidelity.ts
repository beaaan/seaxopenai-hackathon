import { z } from "zod";
import { prompt } from "../core/prompts";
import { policyText, referenceText, type StageContext } from "../pipeline/context";
import { FactCheck, FidelityResult, type PolicyVersion, type Surface } from "../shared/schema";

const FidelityOutput = z.strictObject({
  facts: z.array(FactCheck),
  newCommitments: z.array(z.string()),
  requiresNewFact: FidelityResult.shape.requiresNewFact,
});

export interface FidelityArgs {
  /** The original v0, even when the candidate is several rewrite iterations later. */
  original: PolicyVersion;
  candidate: Surface[];
}

/** Independent, fresh call: neither findings nor the rewriter's explanation are exposed. */
export async function checkFidelity(ctx: StageContext, args: FidelityArgs): Promise<FidelityResult> {
  const checkedFacts = ctx.reference?.facts.filter((fact) => fact.sentenceIds.length > 0) ?? [];
  const result = await ctx.gateway.structured({
    role: "fidelity",
    instructions: prompt("fidelity", {
      original: policyText(args.original, { ids: true }),
      candidate: args.candidate.map((surface) => `## ${surface.label} [${surface.id}]\n${surface.text}`).join("\n\n"),
      reference: referenceText(ctx.reference),
    }),
    input: JSON.stringify({ checkedFacts }),
    schema: FidelityOutput,
    schemaName: "policy_fidelity",
    model: ctx.config.models.judge,
    effort: "high",
    fresh: true,
  });
  const facts = checkedFacts.map((fact) => {
    const checks = result.facts.filter((check) => check.factId === fact.id);
    if (checks.length !== 1) {
      return { factId: fact.id, entailed: false, why: "The checker did not return exactly one assessment of this required fact." };
    }
    return checks[0]!;
  });
  const newCommitments = [...new Set(result.newCommitments.map((text) => text.trim()).filter(Boolean))];
  const requiresNewFact = newCommitments.length === 0 ? null : result.requiresNewFact ?? {
    text: newCommitments.join("; "),
    kind: "changes_rule" as const,
  };
  return FidelityResult.parse({
    passed: facts.every((fact) => fact.entailed) && newCommitments.length === 0,
    facts,
    newCommitments,
    requiresNewFact,
  });
}
