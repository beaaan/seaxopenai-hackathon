import type { ChoiceOption, DecisionAnswer, DecisionQuestion } from "../core/llm/decisions";
import { prompt } from "../core/prompts";
import { policyText, referenceText, type StageContext } from "../pipeline/context";
import type { Grade, GradeLabel, PolicyVersion, Reading } from "../shared/schema";

export const DEFAULT_CONFLICT_THRESHOLD = 0.5;

const LABEL_CHOICES: ChoiceOption[] = [
  { value: "consistent", description: "Matches what the policy text or reference facts say." },
  { value: "conflicts", description: "Contradicts a reference FACT or the policy text." },
  { value: "outside", description: "Asserts something the text does not say, including NOT COVERED items; lack of coverage is not a contradiction." },
  { value: "unclear", description: "Cannot tell whether the interpretation matches, contradicts, or goes beyond the text and facts." },
];
const NON_CONFLICT_LABELS: Exclude<GradeLabel, "conflicts">[] = ["consistent", "outside", "unclear"];

type ChoiceAnswer = Extract<DecisionAnswer, { type: "choice" }>;

function probabilityOf(answer: ChoiceAnswer, label: GradeLabel): number {
  return answer.probabilities.find((p) => p.value === label)?.probability
    ?? (answer.choice === label ? answer.confidence : 0);
}

export async function gradeReadings(
  ctx: StageContext,
  version: PolicyVersion,
  readings: Reading[],
  threshold = DEFAULT_CONFLICT_THRESHOLD,
): Promise<Grade[]> {
  const reference = ctx.reference;
  if (reference === null) {
    return readings.flatMap((reading) => reading.interpretations.map((interpretation): Grade => ({
      readingId: reading.id,
      interpretationId: interpretation.id,
      label: "unclear",
      confidence: 0,
      factIds: [],
      why: null,
    })));
  }
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new RangeError("Conflict threshold must be between 0 and 1.");
  }
  if (readings.length === 0) return [];

  const evidence = prompt("grade", {
    policy: policyText(version, { ids: true }),
    reference: referenceText(reference),
  });
  const factIds = new Set(reference.facts.map((fact) => fact.id));
  const factChoices: ChoiceOption[] = [
    ...reference.facts.map((fact) => ({ value: fact.id, description: fact.text })),
    { value: "none", description: "No reference fact is directly concerned by this interpretation." },
  ];
  let missingAnswers = 0;

  const results = await Promise.all(readings.map(async (reading): Promise<Grade[]> => {
    if (reading.interpretations.length === 0) return [];
    const questions: DecisionQuestion[] = [];
    for (let index = 0; index < reading.interpretations.length; index++) {
      questions.push({
        type: "choice",
        name: `i${index + 1}_label`,
        instructions: `Classify interpretations[${index}] against the policy text and reference. Judge the reader's asserted meaning, not merely its quoted words.`,
        choices: LABEL_CHOICES,
      });
      if (reference.facts.length > 0) {
        questions.push({
          type: "choice",
          name: `i${index + 1}_fact`,
          instructions: `Which reference FACT does interpretations[${index}] most concern, regardless of its grade? Choose none when no fact directly applies.`,
          choices: factChoices,
        });
      }
    }
    const answers = await ctx.gateway.decide({
      role: "grader",
      evidence,
      data: {
        paraphraseVi: reading.paraphraseVi,
        interpretations: reading.interpretations.map(({ id, quote, meaningVi, glossEn }) => ({ id, quote, meaningVi, glossEn })),
      },
      questions,
      fresh: ctx.config.fresh,
    });
    const byName = new Map(answers.map((answer) => [answer.name, answer]));
    for (const question of questions) {
      const answer = byName.get(question.name);
      if (answer?.type !== "choice" || (question.type === "choice" && !question.choices.some((option) => option.value === answer.choice))) missingAnswers++;
    }
    return reading.interpretations.map((interpretation, index): Grade => {
      const answer = byName.get(`i${index + 1}_label`);
      if (answer?.type !== "choice" || !LABEL_CHOICES.some((option) => option.value === answer.choice)) {
        return { readingId: reading.id, interpretationId: interpretation.id, label: "unclear", confidence: 0, factIds: [], why: null };
      }
      let label: GradeLabel = "conflicts";
      if (probabilityOf(answer, "conflicts") < threshold) {
        label = NON_CONFLICT_LABELS[0]!;
        for (const candidate of NON_CONFLICT_LABELS) {
          if (probabilityOf(answer, candidate) > probabilityOf(answer, label)) label = candidate;
        }
      }
      const fact = byName.get(`i${index + 1}_fact`);
      return {
        readingId: reading.id,
        interpretationId: interpretation.id,
        label,
        confidence: answer.probabilities.find((probability) => probability.value === label)?.probability ?? answer.confidence,
        factIds: fact?.type === "choice" && factIds.has(fact.choice) ? [fact.choice] : [],
        why: null,
      };
    });
  }));
  if (missingAnswers > 0) ctx.log("warn", `Grading received ${missingAnswers} refused or missing Decisions answers; affected labels are unclear and unavailable fact links are omitted.`);
  return results.flat();
}
