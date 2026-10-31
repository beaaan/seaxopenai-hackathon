import { z } from "zod";
import { prompt } from "../core/prompts";
import { policyText, referenceText, type StageContext } from "../pipeline/context";
import { FactCheck, FidelityResult, type PolicyVersion, type Surface } from "../shared/schema";
import { splitSurfaces } from "../shared/sentences";

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
  const remaining = new Map<string, Map<string, number>>();
  for (const sentence of splitSurfaces(args.candidate)) {
    const counts = remaining.get(sentence.surfaceId) ?? new Map<string, number>();
    counts.set(sentence.text, (counts.get(sentence.text) ?? 0) + 1);
    remaining.set(sentence.surfaceId, counts);
  }
  const changedSentences = args.original.sentences.filter((sentence) => {
    const counts = remaining.get(sentence.surfaceId);
    const available = counts?.get(sentence.text) ?? 0;
    if (available === 0) return true;
    counts!.set(sentence.text, available - 1);
    return false;
  });
  const evidence = prompt("fidelity", {
    original: policyText(args.original, { ids: true }),
    candidate: args.candidate.map((surface) => `## ${surface.label} [${surface.id}]\n${surface.text}`).join("\n\n"),
    reference: referenceText(ctx.reference),
  });
  const [result, sentenceAnswers] = await Promise.all([
    ctx.gateway.structured({
      role: "fidelity",
      instructions: evidence,
      input: JSON.stringify({ checkedFacts }),
      schema: FidelityOutput,
      schemaName: "policy_fidelity",
      model: ctx.config.models.judge,
      effort: "high",
      fresh: true,
    }),
    changedSentences.length === 0 ? Promise.resolve([]) : ctx.gateway.decide({
      role: "fidelity-preservation",
      evidence,
      data: { originalSentences: changedSentences },
      questions: changedSentences.map((sentence, index) => ({
        type: "predicate" as const,
        name: `sentence-${index + 1}`,
        instructions: `Every rule, condition, exception, scope and degree of certainty in original sentence [${sentence.id}] ${JSON.stringify(sentence.text)} is still stated or implied by the candidate text. Evaluate the candidate itself, not what the reference says; an original sentence with no substantive rule is preserved.`,
      })),
      fresh: true,
    }),
  ]);
  const facts = checkedFacts.map((fact) => {
    const checks = result.facts.filter((check) => check.factId === fact.id);
    if (checks.length !== 1) {
      return { factId: fact.id, entailed: false, why: "The checker did not return exactly one assessment of this required fact." };
    }
    return checks[0]!;
  });
  const sentenceAnswerByName = new Map(sentenceAnswers.map((answer) => [answer.name, answer]));
  for (const [index, sentence] of changedSentences.entries()) {
    const answer = sentenceAnswerByName.get(`sentence-${index + 1}`);
    const probability = answer?.type === "predicate" && Number.isFinite(answer.probability) && answer.probability >= 0 && answer.probability <= 1
      ? answer.probability : null;
    facts.push({
      factId: sentence.id,
      entailed: probability !== null && probability >= 0.5,
      why: `sentence preserved p=${probability === null ? "unavailable" : probability.toFixed(2)}; ${probability === null ? "missing or refused preservation assessment" : probability < 0.5 ? "the candidate does not preserve every original rule" : "the candidate preserves every original rule"} in [${sentence.id}].`,
    });
  }
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
