import path from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppServerBackend } from "../src/core/llm/appserver";
import type { ThreadItemRecord } from "../src/shared/schema";
import { UsageEvent } from "../src/core/llm/usage";

const FAKE = path.join(import.meta.dirname, "fixtures", "fake-app-server.mjs");

let backend: AppServerBackend;

function makeBackend(): AppServerBackend {
  backend = new AppServerBackend({ command: process.execPath, args: [FAKE], concurrency: 4, turnTimeoutMs: 5_000, shell: false });
  return backend;
}

afterEach(async () => {
  await backend.close();
  vi.unstubAllEnvs();
});

describe("AppServerBackend", () => {
  it("returns each concurrent structured call its own parsed output", async () => {
    const b = makeBackend();
    const schema = z.strictObject({ echo: z.string() });
    const inputs = ["một", "hai hai", "ba ba ba", "bốn bốn bốn bốn", "năm", "sáu sáu"];
    const outputs = await Promise.all(
      inputs.map((input) => b.structured({ role: "t", instructions: "x", input, schema, schemaName: "echo", model: "m", effort: "low" })),
    );
    expect(outputs.map((o) => o.echo)).toEqual(inputs);
  });

  it("answers dynamic tool calls with the handler result and reports the items", async () => {
    const b = makeBackend();
    const seenArgs: unknown[] = [];
    const records: ThreadItemRecord[] = [];
    const thread = await b.agentThread({
      role: "hero",
      label: "test persona",
      instructions: "persona",
      tools: [
        {
          name: "refuse_delivery",
          description: "refuse",
          input: z.strictObject({ order_id: z.string() }),
          handler: async (args) => {
            seenArgs.push(args);
            return { refused: true };
          },
        },
      ],
      model: "m",
      effort: "low",
      persist: false,
      onItem: (r) => records.push(r),
    });
    const result = await thread.turn("please use tool now");
    expect(seenArgs).toEqual([{ order_id: "o1" }]);
    expect(result.finalText).toBe(`done:${JSON.stringify({ refused: true })}`);
    expect(records.map((r) => r.itemType)).toEqual(["userMessage", "dynamicToolCall", "agentMessage"]);
    expect(records.every((r) => r.threadId === thread.threadId && r.backend === "appserver")).toBe(true);
  });

  it("returns a handler failure to the model instead of crashing the turn", async () => {
    const b = makeBackend();
    const thread = await b.agentThread({
      role: "probe",
      label: "p",
      instructions: "persona",
      tools: [
        {
          name: "refuse_delivery",
          description: "refuse",
          input: z.strictObject({ order_id: z.string() }),
          handler: async () => {
            throw new Error("order already delivered");
          },
        },
      ],
      model: "m",
      effort: "low",
      persist: false,
    });
    const result = await thread.turn("use tool");
    expect(result.finalText).toContain("order already delivered");
  });

  it("rejects when the turn fails", async () => {
    const b = makeBackend();
    await expect(
      b.structured({ role: "t", instructions: "x", input: "please fail", schema: z.strictObject({ echo: z.string() }), schemaName: "e", model: "m", effort: "low" }),
    ).rejects.toThrow(/turn failed/);
  });

  it("aggregates usage across tool steps and subtracts earlier thread turns", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pwt-appserver-usage-"));
    const file = path.join(dir, "usage.jsonl");
    vi.stubEnv("PWT_USAGE_LOG", file);
    const b = makeBackend();
    try {
      const thread = await b.agentThread({ role: "reviewer", stage: "reviewer", label: "usage", instructions: "review", tools: [], model: "gpt-6.1-sol", effort: "low", persist: false });
      await thread.turn("usage one");
      await thread.turn("usage two");
      const rows = readFileSync(file, "utf8").trim().split("\n").map((line) => UsageEvent.parse(JSON.parse(line)));
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row).toMatchObject({ backend: "appserver", stage: "reviewer", model: "gpt-6.1-sol", inputTokens: 200, cachedInputTokens: 80, outputTokens: 40, reasoningTokens: 10 });
      await thread.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("records nulls rather than estimates when a turn reports no usage", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pwt-appserver-missing-"));
    const file = path.join(dir, "usage.jsonl");
    vi.stubEnv("PWT_USAGE_LOG", file);
    const b = makeBackend();
    try {
      await b.structured({ role: "reader", stage: "reader", instructions: "read", input: "no counts", schema: z.strictObject({ echo: z.string() }), schemaName: "echo", model: "gpt-6.1-sol", effort: "low" });
      const row = UsageEvent.parse(JSON.parse(readFileSync(file, "utf8").trim()));
      expect(row).toMatchObject({ backend: "appserver", stage: "reader", inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
