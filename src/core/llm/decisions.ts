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
import type { StructuredRequest } from "./types";
import { logUsage, responseUsage, type UsageStage } from "./usage";

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
  stage?: UsageStage;
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
      limiter.run(async () => {
        const result = await create({ model: DECISIONS_MODEL, input: [content], questions: chunk, prompt_cache_key: `pwt-${req.role}` });
        logUsage({ backend: "decisions", model: result.model, stage: req.stage ?? "decisions", ...responseUsage(result.usage) });
        return result;
      }),
    ),
  );

  return chunks.flatMap((chunk, c) => {
    const answers = results[c]?.answers ?? [];
    return chunk.map((question) => {
      const raw = answers.find((a) => a.name === question.name);
      if (!raw) throw new Error(`decisions ${req.role}: no answer named "${question.name}"`);
      const answer = toAnswer(raw, question.name);
      if (answer.type !== "refusal" && answer.type !== question.type) {
        throw new Error(`decisions ${req.role}: "${question.name}" asked ${question.type}, got ${answer.type}`);
      }
      if (answer.type === "choice" && question.type === "choice" && !question.choices.some((o) => o.value === answer.choice)) {
        throw new Error(`decisions ${req.role}: "${question.name}" chose "${answer.choice}", not an allowed value`);
      }
      if (answer.type === "predicate" && (answer.probability < 0 || answer.probability > 1)) {
        throw new Error(`decisions ${req.role}: "${question.name}" probability ${answer.probability} out of [0,1]`);
      }
      return answer;
    });
  });
}

// ---------------------------------------------------------------------------
// Fallback without an API key: emulate with structured outputs (model-reported probabilities).

const EMULATION_CHUNK = 60;

const EmulatedAnswers = z.strictObject({
  answers: z.array(
    z.strictObject({
      name: z.string(),
      probability: z.number().nullable(), // predicate
      choice: z.string().nullable(), // choice: one of the allowed values
      choiceProbabilities: z.array(z.strictObject({ value: z.string(), probability: z.number() })).nullable(), // choice: every allowed value
      levelIndex: z.number().int().nullable(), // score: 0-based level index
      confidence: z.number().nullable(),
    }),
  ),
});

function describeQuestion(q: DecisionQuestion): string {
  switch (q.type) {
    case "predicate":
      return `- name: ${q.name}\n  type: predicate (give probability 0..1 that it is true)\n  question: ${q.instructions}`;
    case "choice":
      return `- name: ${q.name}\n  type: choice (give the most likely value in choice, and in choiceProbabilities a probability 0..1 for EVERY value, summing to 1)\n  question: ${q.instructions}\n  values:\n${q.choices.map((c) => `    - ${c.value}: ${c.description}`).join("\n")}`;
    case "score":
      return `- name: ${q.name}\n  type: score (give 0-based levelIndex + confidence 0..1)\n  question: ${q.instructions}\n  levels:\n${q.levels.map((l, i) => `    ${i}. ${l.label}: ${l.description}`).join("\n")}`;
  }
}

export async function emulateDecisions(
  structured: (req: StructuredRequest<z.infer<typeof EmulatedAnswers>>) => Promise<z.infer<typeof EmulatedAnswers>>,
  req: DecisionRequest,
): Promise<DecisionAnswer[]> {
  const chunks: DecisionQuestion[][] = [];
  for (let i = 0; i < req.questions.length; i += EMULATION_CHUNK) chunks.push(req.questions.slice(i, i + EMULATION_CHUNK));
  const results = await Promise.all(
    chunks.map((chunk) =>
      structured({
        role: `decide-emulated-${req.role}`,
        stage: req.stage ?? "decisions",
        instructions:
          "You are a careful classifier. Answer every question about the evidence. Return one answer per question name, using only the field for its type; set the other fields to null.",
        input: `EVIDENCE:\n${req.evidence}\n\n${req.data === null ? "" : `DATA (JSON):\n${JSON.stringify(req.data)}\n\n`}QUESTIONS:\n${chunk.map(describeQuestion).join("\n")}`,
        schema: EmulatedAnswers,
        schemaName: "decisions",
        model: DECISIONS_MODEL,
        effort: "low",
        fresh: req.fresh,
      }),
    ),
  );
  return chunks.flatMap((chunk, c) =>
    chunk.map((q): DecisionAnswer => {
      const a = results[c]?.answers.find((x) => x.name === q.name);
      if (!a) return { type: "refusal", name: q.name };
      const confidence = Math.min(1, Math.max(0, a.confidence ?? 0.5));
      switch (q.type) {
        case "predicate":
          return a.probability === null ? { type: "refusal", name: q.name } : { type: "predicate", name: q.name, probability: Math.min(1, Math.max(0, a.probability)) };
        case "choice": {
          const allowed = q.choices.map((c) => c.value);
          const distribution = completeDistribution(allowed, a.choiceProbabilities);
          if (distribution !== null) {
            const top = distribution.reduce((best, p) => (p.probability > best.probability ? p : best));
            return { type: "choice", name: q.name, choice: top.value, confidence: top.probability, probabilities: distribution };
          }
          // No usable distribution: keep only what was reported (the chosen value), so consumers see P(other values) as unknown.
          const value = allowed.find((v) => v === a.choice);
          return value === undefined ? { type: "refusal", name: q.name } : { type: "choice", name: q.name, choice: value, confidence, probabilities: [{ value, probability: confidence }] };
        }
        case "score": {
          const level = a.levelIndex === null ? undefined : q.levels[a.levelIndex];
          return level === undefined || a.levelIndex === null
            ? { type: "refusal", name: q.name }
            : { type: "score", name: q.name, score: a.levelIndex, confidence, probabilities: [{ label: level.label, value: a.levelIndex, probability: confidence }] };
        }
      }
    }),
  );
}

/**
 * A model-reported distribution is used only when it gives exactly one finite probability in [0, 1] for every allowed
 * value and nothing else; it is then normalised to sum to 1. A partial answer would otherwise turn a missing value into a
 * confident 0 (e.g. only `consistent: 0.3` becoming P(conflicts) = 0).
 */
function completeDistribution(allowed: readonly string[], reported: ReadonlyArray<{ value: string; probability: number }> | null): Array<{ value: string; probability: number }> | null {
  if (reported === null || reported.length !== allowed.length) return null;
  const byValue = new Map<string, number>();
  for (const p of reported) {
    if (!allowed.includes(p.value) || byValue.has(p.value) || !Number.isFinite(p.probability) || p.probability < 0 || p.probability > 1) return null;
    byValue.set(p.value, p.probability);
  }
  const total = [...byValue.values()].reduce((sum, p) => sum + p, 0);
  if (total <= 0) return null;
  return allowed.map((value) => ({ value, probability: (byValue.get(value) ?? 0) / total }));
}
