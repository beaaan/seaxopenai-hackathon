import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { summarizeUsage } from "../scripts/usage-summary";
import { UsageEvent, logUsage, responseUsage } from "../src/core/llm/usage";
import { Gateway } from "../src/core/llm/gateway";
import { ResponsesBackend } from "../src/core/llm/responses";
import { decideChunked } from "../src/core/llm/decisions";
import { Limiter } from "../src/core/llm/limit";

const api = vi.hoisted(() => ({
  responses: vi.fn(async () => ({
    model: "gpt-6.1-sol", status: "completed", id: "response-test", output_text: '{"ok":true}', output: [],
    usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 40 }, output_tokens: 20, output_tokens_details: { reasoning_tokens: 5 } },
  })),
  embeddings: vi.fn(async () => ({ model: "text-embedding-3-small", data: [{ index: 0, embedding: [0.1, 0.2] }], usage: { prompt_tokens: 8 } })),
}));
vi.mock("openai", () => ({ default: class {
  responses = { create: api.responses };
  embeddings = { create: api.embeddings };
} }));
vi.mock("../src/core/env", () => ({ config: {
  openaiApiKey: "test", bulkBackend: "responses", agentBackend: "responses", responsesConcurrency: 4, turnTimeoutMs: 1000,
} }));

let dir: string;
let file: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "pwt-usage-"));
  file = path.join(dir, "usage.jsonl");
  vi.stubEnv("PWT_USAGE_LOG", file);
  vi.clearAllMocks();
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });
const events = () => readFileSync(file, "utf8").trim().split("\n").map((line) => UsageEvent.parse(JSON.parse(line)));

const request = () => ({ role: "reader", stage: "reader" as const, instructions: "read", input: "policy", schema: z.strictObject({ ok: z.boolean() }), schemaName: "reading", model: "gpt-6.1-sol", effort: "low" as const });

describe("opt-in reported usage", () => {
  it("does nothing without a log path and keeps unreported values null", () => {
    vi.stubEnv("PWT_USAGE_LOG", "");
    logUsage({ backend: "responses", model: "gpt-6.1-sol", stage: "other", ...responseUsage(undefined) });
    expect(existsSync(file)).toBe(false);
    expect(responseUsage(undefined)).toEqual({ inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null });
  });

  it("logs real structured calls but not cache hits or coalesced calls", async () => {
    const gateway = new Gateway({ bulk: "responses", agent: "responses", cacheDir: path.join(dir, "cache") });
    try {
      await Promise.all([gateway.structured(request()), gateway.structured(request())]);
      await gateway.structured(request());
      expect(api.responses).toHaveBeenCalledTimes(1);
      expect(events()).toEqual([expect.objectContaining({ backend: "responses", model: "gpt-6.1-sol", stage: "reader", inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, reasoningTokens: 5 })]);
      await gateway.structured({ ...request(), fresh: true });
      expect(events()).toHaveLength(2);
    } finally { await gateway.close(); }
  });

  it("logs each function-loop API call with its thread stage", async () => {
    const backend = new ResponsesBackend("test");
    const thread = await backend.agentThread({ role: "reviewer", stage: "reviewer", label: "allocation", instructions: "review", tools: [], model: "gpt-6.1-sol", effort: "low", persist: false });
    await thread.turn("allocate");
    expect(events()[0]).toMatchObject({ backend: "responses", stage: "reviewer", inputTokens: 100 });
    await thread.close();
  });

  it("logs one real Decisions request per question chunk with the caller stage", async () => {
    await decideChunked(async (body) => ({
      model: body.model,
      answers: body.questions.map((question) => ({ type: "predicate" as const, name: question.name ?? null, probability: 0.5 })),
      usage: { input_tokens: 80, input_tokens_details: { cached_tokens: 20, cache_write_tokens: 0 }, output_tokens: 10, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 90 },
    }), new Limiter(2), {
      role: "grader", stage: "grader", evidence: "facts", data: null,
      questions: Array.from({ length: 401 }, (_, index) => ({ type: "predicate", name: `q${index}`, instructions: "true?" })),
    });
    expect(events()).toHaveLength(2);
    for (const event of events()) expect(event).toMatchObject({ backend: "decisions", stage: "grader", model: "gpt-6-luna", inputTokens: 80, cachedInputTokens: 20, outputTokens: 10, reasoningTokens: 0 });
  });

  it("embeddings bypass cache when fresh and retain absent usage fields", async () => {
    const gateway = new Gateway({ cacheDir: path.join(dir, "cache") });
    try {
      await gateway.embed(["a"]);
      await gateway.embed(["a"]);
      await gateway.embed(["a"], { fresh: true });
      expect(api.embeddings).toHaveBeenCalledTimes(2);
      expect(events()).toHaveLength(2);
      expect(events()[0]).toMatchObject({ backend: "embeddings", stage: "embeddings", inputTokens: 8, cachedInputTokens: null, outputTokens: null, reasoningTokens: null });
    } finally { await gateway.close(); }
  });
});

describe("usage cost summary", () => {
  const event: UsageEvent = { ts: "2026-10-31T10:00:00.000Z", backend: "responses", stage: "reader", model: "gpt-6.1-sol", inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, reasoningTokens: 5 };
  it("discounts cached input and never adds reasoning to output again", () => {
    const result = summarizeUsage([event, event], "test", 1, 2);
    expect(result.stages[0]).toMatchObject({ calls: 2, inputTokens: 200, cachedInputTokens: 80, outputTokens: 40, reasoningTokens: 10 });
    expect(result.totalCostUsd).toBeCloseTo(2 * (60 * 2 + 40 * 0.1 + 20 * 10) / 1_000_000);
    expect(result.missingUsage).toEqual([]);
  });
  it("prices embeddings using reported input and explicitly lists absent fields", () => {
    const result = summarizeUsage([{ ...event, backend: "embeddings", stage: "embeddings", model: "text-embedding-3-small", cachedInputTokens: null, outputTokens: null, reasoningTokens: null }], "test", 1, 2);
    expect(result.totalCostUsd).toBeCloseTo(100 * 0.02 / 1_000_000);
    expect(result.missingUsage).toEqual([{ stage: "embeddings", model: "text-embedding-3-small", calls: 1, fields: ["cachedInputTokens", "outputTokens", "reasoningTokens"], costIncomplete: false }]);
  });
  it("does not silently price unreported billable usage as zero", () => {
    const result = summarizeUsage([event, { ...event, inputTokens: null }], "test", 1, 2);
    expect(result.totalCostUsd).toBeNull();
    expect(result.measuredCostUsd).toBeGreaterThan(0);
    expect(result.stages[0]?.inputTokens).toBeNull();
    expect(result.stages[0]?.costUsd).toBeNull();
    expect(result.missingUsage[0]?.costIncomplete).toBe(true);
  });
});
