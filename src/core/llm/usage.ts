import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

export const UsageStage = z.enum([
  "dims", "reader", "grader", "coder", "embeddings", "reviewer", "judge", "repair", "fidelity",
  "resolution", "baseline", "score", "probe", "decisions", "other",
]);
export type UsageStage = z.infer<typeof UsageStage>;

const TokenCount = z.number().int().nonnegative().nullable();
export const UsageEvent = z.strictObject({
  ts: z.iso.datetime(),
  backend: z.enum(["responses", "appserver", "decisions", "embeddings"]),
  model: z.string().min(1),
  stage: UsageStage,
  inputTokens: TokenCount,
  cachedInputTokens: TokenCount,
  outputTokens: TokenCount,
  reasoningTokens: TokenCount,
});
export type UsageEvent = z.infer<typeof UsageEvent>;
export type TokenUsage = Pick<UsageEvent, "inputTokens" | "cachedInputTokens" | "outputTokens" | "reasoningTokens">;

interface ApiUsage {
  input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
  output_tokens?: number;
  output_tokens_details?: { reasoning_tokens?: number };
}

/** Reasoning tokens are a breakdown of output_tokens, not additional billable output. */
export function responseUsage(usage: ApiUsage | null | undefined): TokenUsage {
  return {
    inputTokens: usage?.input_tokens ?? null,
    cachedInputTokens: usage?.input_tokens_details?.cached_tokens ?? null,
    outputTokens: usage?.output_tokens ?? null,
    reasoningTokens: usage?.output_tokens_details?.reasoning_tokens ?? null,
  };
}

/** Only backends call this, after a real request; cache hits never reach it. */
export function logUsage(event: Omit<UsageEvent, "ts">): void {
  const file = process.env.PWT_USAGE_LOG;
  if (!file) return;
  mkdirSync(dirname(file), { recursive: true });
  // One synchronous append keeps concurrent calls in this process from interleaving.
  appendFileSync(file, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`, "utf8");
}
