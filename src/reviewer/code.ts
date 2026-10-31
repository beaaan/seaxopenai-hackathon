import type { DecisionQuestion } from "../core/llm/decisions";
import { versionZero } from "../core/policy";
import { prompt } from "../core/prompts";
import { policyText, type StageContext } from "../pipeline/context";
import type { Cluster, Coding, Reading } from "../shared/schema";

export async function codeReadings(
  ctx: StageContext,
  args: { readings: Reading[]; codebook: Cluster[]; stage?: "coder" | "resolution" },
): Promise<Coding[]> {
  if (args.readings.length === 0 || args.codebook.length === 0) return [];
  // The original policy and frozen codebook remain identical across policy-version retests.
  const evidence = prompt("code", {
    policy: policyText(versionZero(ctx.policy), { ids: false }),
    codebook: JSON.stringify(args.codebook, null, 2),
  });
  const questions: DecisionQuestion[] = args.codebook.map((cluster, index) => ({
    type: "predicate",
    name: `c${index + 1}`,
    instructions: `Does this reading express or clearly imply the belief labelled by codebook cluster ${JSON.stringify(cluster.id)}? Judge the reader's belief, not whether it is true.`,
  }));
  let missingAnswers = 0;
  const results = await Promise.all(args.readings.map(async (reading): Promise<Coding[]> => {
    const answers = await ctx.gateway.decide({
      role: "coder",
      stage: args.stage ?? "coder",
      evidence,
      data: {
        paraphraseVi: reading.paraphraseVi,
        interpretations: reading.interpretations.map(({ meaningVi, glossEn }) => ({ meaningVi, glossEn })),
        questions: reading.questions,
        actions: reading.actions,
      },
      questions,
      fresh: ctx.config.fresh,
    });
    const byName = new Map(answers.map((answer) => [answer.name, answer]));
    const codings: Coding[] = [];
    for (const [index, cluster] of args.codebook.entries()) {
      const answer = byName.get(`c${index + 1}`);
      if (answer?.type !== "predicate") {
        missingAnswers++;
        continue;
      }
      codings.push({
        readingId: reading.id,
        clusterId: cluster.id,
        probability: answer.probability,
      });
    }
    return codings;
  }));
  if (missingAnswers > 0) ctx.log("warn", `${missingAnswers} codings missing`);
  return results.flat();
}
