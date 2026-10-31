/**
 * OpenAI Decisions API (`POST /v1/decisions`, gpt-6-luna only): typed answers
 * (predicate probability, choice distribution, score) about shared evidence,
 * ~10x faster than Responses and up to 400 questions per request.
 *
 * Our measurement layer: grading interpretations against reference facts, coding
 * readings against the cluster codebook, anchoring quotes, mapping human answers.
 * Generation (readings, findings, rewrites) stays on the Responses API.
 */
import type { Decision, DecisionCreateParams } from "openai/resources/decisions";
import { z } from "zod";
import type { Limiter } from "./limit";

export const DECISIONS_MODEL = "gpt-6-luna";
export const MAX_QUESTIONS_PER_REQUEST = 400;

export interface ChoiceOption {
  value: string;
  description: string;
}

export interface ScoreLevel {
  label: string;
  description: string;
}

export type DecisionQuestion =
  | { type: "predicate"; name: string; instructions: string }
  | { type: "choice"; name: string; instructions: string; choices: ChoiceOption[] }
  | { type: "score"; name: string; instructions: string; levels: ScoreLevel[] };

export const DecisionAnswerSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("predicate"), name: z.string(), probability: z.number() }),
  z.strictObject({
    type: z.literal("choice"),
    name: z.string(),
    choice: z.string(),
    confidence: z.number(),
    probabilities: z.array(z.strictObject({ value: z.string(), probability: z.number() })),
  }),
  z.strictObject({
    type: z.literal("score"),
    name: z.string(),
    score: z.number(),
    confidence: z.number(),
    probabilities: z.array(z.strictObject({ label: z.string(), value: z.number(), probability: z.number() })),
  }),
  z.strictObject({ type: z.literal("refusal"), name: z.string() }),
]);
export type DecisionAnswer = z.infer<typeof DecisionAnswerSchema>;
export const DecisionAnswers = z.array(DecisionAnswerSchema);

export interface DecisionRequest {
  /** Pipeline role: "grader", "coder", "anchor", "human-map", ... (cache key + prompt_cache_key). */
  role: string;
  /**
   * Shared evidence for every question. Put long, stable context (policy text, reference
   * facts) first: the prompt-cache prefix is reused across requests when it is identical.
   */
  evidence: string;
  /** Structured evidence sent as an `input_json` part after the text (e.g. one reading). null for none. */
  data: JsonEvidence | null;
  /** Unique names; answers come back keyed by name, in question order. */
  questions: DecisionQuestion[];
  /** Skip the cache read (noise-band and live runs). */
  fresh?: boolean;
}

export type JsonEvidence = Record<string, unknown> | Array<Record<string, unknown>>;

export type CreateDecision = (body: DecisionCreateParams) => Promise<Decision>;

function toAnswer(raw: Decision["answers"][number], name: string): DecisionAnswer {
  switch (raw.type) {
    case "predicate":
      return { type: "predicate", name, probability: raw.probability };
    case "choice":
      return {
        type: "choice",
        name,
        choice: String(raw.choice),
        confidence: raw.confidence,
        probabilities: raw.probabilities.map((p) => ({ value: String(p.value), probability: p.probability })),
      };
    case "score":
      return { type: "score", name, score: raw.score, confidence: raw.confidence, probabilities: raw.probabilities };
    case "refusal":
      return { type: "refusal", name };
  }
}

/**
 * Splits questions into requests of at most 400 sharing the same evidence, runs them
 * through `limiter`, and returns one answer per question in the original order.
 */
export async function decideChunked(create: CreateDecision, limiter: Limiter, req: DecisionRequest): Promise<DecisionAnswer[]> {
  const names = req.questions.map((q) => q.name);
  const duplicate = names.find((name, i) => names.indexOf(name) !== i);
  if (duplicate !== undefined) throw new Error(`decisions ${req.role}: duplicate question name "${duplicate}"`);
  if (req.questions.length === 0) return [];

  const content: Extract<DecisionCreateParams["input"], unknown[]>[number] = {
    role: "user",
    content: [
      { type: "input_text", text: req.evidence },
      ...(req.data === null ? [] : [{ type: "input_json" as const, data: req.data }]),
    ],
  };

  const chunks: DecisionQuestion[][] = [];
  for (let i = 0; i < req.questions.length; i += MAX_QUESTIONS_PER_REQUEST) chunks.push(req.questions.slice(i, i + MAX_QUESTIONS_PER_REQUEST));

  const results = await Promise.all(
    chunks.map((chunk) =>
      limiter.run(() => create({ model: DECISIONS_MODEL, input: [content], questions: chunk, prompt_cache_key: `pwt-${req.role}` })),
    ),
  );

  return chunks.flatMap((chunk, c) => {
    const answers = results[c]?.answers ?? [];
    return chunk.map((question, i) => {
      const raw = answers.find((a) => a.name === question.name) ?? answers[i];
      if (!raw) throw new Error(`decisions ${req.role}: no answer for "${question.name}"`);
      return toAnswer(raw, question.name);
    });
  });
}
