import { z } from "zod";
import type { DecisionQuestion } from "../core/llm/decisions";
import { versionZero } from "../core/policy";
import { prompt } from "../core/prompts";
import { policyText, type StageContext } from "../pipeline/context";
import type { Cluster, Finding, HumanAnswer, HumanMapping, HumanQuestion, PolicyVersion } from "../shared/schema";

const QuestionSet = z.strictObject({
  questions: z.array(z.strictObject({ questionVi: z.string().min(1) })).length(3),
});
const Probability = z.number().min(0).max(1);

export async function humanQuestions(ctx: StageContext, version: PolicyVersion, findings: Finding[]): Promise<HumanQuestion[]> {
  if (findings.length === 0) return [];
  const targets = Array.from({ length: 3 }, (_, index) => findings[index % Math.min(findings.length, 3)]!);
  const result = await ctx.gateway.structured({
    role: "human-questions",
    instructions: prompt("human-questions"),
    input: JSON.stringify({
      policy: policyText(version, { ids: true }),
      targets: targets.map((finding) => ({ sentenceIds: finding.sentenceIds, readingSummary: finding.readingSummary })),
    }),
    schema: QuestionSet,
    schemaName: "human_questions",
    model: ctx.config.models.judge,
    effort: "high",
    fresh: ctx.config.fresh,
  });
  return result.questions.map((question, index) => ({ id: `hq${index + 1}`, questionVi: question.questionVi, findingIds: [targets[index]!.id] }));
}

export interface BeliefProbability {
  clusterId: string;
  probability: number;
}

export interface HumanBeliefSelection {
  findingId: string | null;
  why: string;
}

/** Stable input order breaks ties; an absent/refused belief is never a measured zero. */
export function selectHumanFinding(findings: Finding[], beliefs: BeliefProbability[]): HumanBeliefSelection {
  const probabilityByCluster = new Map(beliefs.map((belief) => [belief.clusterId, belief.probability]));
  let findingId: string | null = null;
  let highest = -1;
  for (const finding of findings) {
    for (const clusterId of finding.evidence.clusterIds) {
      const probability = probabilityByCluster.get(clusterId);
      if (probability !== undefined && probability >= 0.5 && probability > highest) {
        highest = probability;
        findingId = finding.id;
      }
    }
  }
  const top = [...beliefs].sort((a, b) => b.probability - a.probability).slice(0, 3);
  return {
    findingId,
    why: top.length === 0 ? "no observed codebook beliefs" : top.map((belief) => `${belief.clusterId}: p=${belief.probability.toFixed(2)}`).join(", "),
  };
}

export async function mapHumanAnswers(ctx: StageContext, args: { answers: HumanAnswer[]; questions: HumanQuestion[]; findings: Finding[]; codebook: Cluster[] }): Promise<HumanMapping[]> {
  if (args.answers.length === 0) return [];
  const questionById = new Map(args.questions.map((question) => [question.id, question]));
  const answerData = args.answers.map((answer) => {
    const question = questionById.get(answer.questionId);
    if (!question) throw new Error(`human answer ${answer.id} references unknown question ${answer.questionId}`);
    return { answer, question };
  });
  if (args.codebook.length === 0) return answerData.map(({ answer }) => ({ answerId: answer.id, ...selectHumanFinding(args.findings, []) }));
  const evidence = prompt("code", {
    policy: policyText(versionZero(ctx.policy), { ids: false }),
    codebook: JSON.stringify(args.codebook, null, 2),
  });
  // Keep predicates identical to reviewer/code.ts: human and simulated readings use one instrument.
  const questions: DecisionQuestion[] = args.codebook.map((cluster, index) => ({
    type: "predicate",
    name: `c${index + 1}`,
    instructions: `Does this reading express or clearly imply the belief labelled by codebook cluster ${JSON.stringify(cluster.id)}? Judge the reader's belief, not whether it is true.`,
  }));
  let missingAnswers = 0;
  const mappings = await Promise.all(answerData.map(async ({ answer, question }): Promise<HumanMapping> => {
    const decisions = await ctx.gateway.decide({
      role: "human-map",
      evidence,
      data: { paraphraseVi: answer.answerVi, interpretations: [], questions: [], actions: [], questionContext: question.questionVi },
      questions,
      fresh: ctx.config.fresh,
    });
    const byName = new Map(decisions.map((decision) => [decision.name, decision]));
    const beliefs: BeliefProbability[] = [];
    for (const [index, cluster] of args.codebook.entries()) {
      const decision = byName.get(`c${index + 1}`);
      if (decision?.type !== "predicate") {
        missingAnswers++;
        continue;
      }
      beliefs.push({ clusterId: cluster.id, probability: Probability.parse(decision.probability) });
    }
    return { answerId: answer.id, ...selectHumanFinding(args.findings, beliefs) };
  }));
  if (missingAnswers > 0) ctx.log("warn", `${missingAnswers} human-answer codings missing or refused`);
  return mappings;
}
