import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { UsageEvent, UsageStage } from "../src/core/llm/usage";
import { readEvents } from "../src/core/store";

const SOURCE = "https://developers.openai.com/api/docs/pricing";
interface Price {
  input: number;
  cachedInput: number | null;
  output: number | null;
  source: string;
}

/** Standard short-context USD per million tokens, retrieved 2026-10-31. */
export const PRICES: Readonly<Record<string, Price>> = {
  "gpt-6.1-sol": { input: 2, cachedInput: 0.10, output: 10, source: SOURCE },
  "gpt-6-luna": { input: 0.10, cachedInput: 0.01, output: 0.50, source: SOURCE },
  "gpt-6-astra": { input: 10, cachedInput: 1, output: 50, source: SOURCE },
  "gpt-6.1-terra": { input: 1, cachedInput: 0.05, output: 5, source: SOURCE },
  "text-embedding-3-small": { input: 0.02, cachedInput: null, output: null, source: SOURCE },
};

const TOKEN_FIELDS = ["inputTokens", "cachedInputTokens", "outputTokens", "reasoningTokens"] as const;
type TokenField = typeof TOKEN_FIELDS[number];
interface StageUsage {
  stage: UsageStage;
  model: string;
  calls: number;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
}

function callCost(event: UsageEvent, price: Price): number | null {
  if (event.inputTokens === null) return null;
  // Embeddings report prompt_tokens only and have no generated-output or cached-input rate.
  if (event.backend === "embeddings") return event.inputTokens * price.input / 1_000_000;
  if (event.cachedInputTokens === null || event.outputTokens === null || price.cachedInput === null || price.output === null) return null;
  if (event.cachedInputTokens > event.inputTokens) throw new Error(`cached input exceeds total input at ${event.ts}`);
  return ((event.inputTokens - event.cachedInputTokens) * price.input
    + event.cachedInputTokens * price.cachedInput + event.outputTokens * price.output) / 1_000_000;
}

export function summarizeUsage(usage: readonly UsageEvent[], runId: string, readers: number, wallSeconds: number) {
  const groups = new Map<string, StageUsage>();
  const missing = new Map<string, { stage: UsageStage; model: string; calls: number; fields: Set<TokenField>; costIncomplete: boolean }>();
  const prices: Record<string, Price> = {};
  let measuredCostUsd = 0;
  let complete = true;
  for (const event of usage) {
    const price = PRICES[event.model];
    if (!price) throw new Error(`No verified price for model ${event.model}`);
    prices[event.model] = price;
    const key = `${event.stage}\0${event.model}`;
    let group = groups.get(key);
    if (!group) {
      group = { stage: event.stage, model: event.model, calls: 0, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 };
      groups.set(key, group);
    }
    group.calls++;
    const absent = TOKEN_FIELDS.filter((field) => event[field] === null);
    const cost = callCost(event, price);
    if (absent.length > 0) {
      let entry = missing.get(key);
      if (!entry) {
        entry = { stage: event.stage, model: event.model, calls: 0, fields: new Set(), costIncomplete: false };
        missing.set(key, entry);
      }
      entry.calls++;
      for (const field of absent) entry.fields.add(field);
      entry.costIncomplete ||= cost === null;
    }
    for (const field of TOKEN_FIELDS) {
      const before = group[field];
      const value = event[field];
      group[field] = before === null || value === null ? null : before + value;
    }
    group.costUsd = group.costUsd === null || cost === null ? null : group.costUsd + cost;
    if (cost === null) complete = false;
    else measuredCostUsd += cost;
  }
  return {
    runId,
    readers,
    measuredAt: new Date().toISOString(),
    prices,
    stages: [...groups.values()].sort((a, b) => a.stage.localeCompare(b.stage) || a.model.localeCompare(b.model)),
    totalCostUsd: complete ? measuredCostUsd : null,
    measuredCostUsd,
    wallSeconds,
    missingUsage: [...missing.values()].map((entry) => ({ ...entry, fields: [...entry.fields] })),
    unmeasuredStages: UsageStage.options.filter((stage) => !usage.some((event) => event.stage === stage)).map((stage) => ({
      stage,
      reason: "No real API call was logged under this stage; it was cached, skipped, or attributed to a more specific stage.",
    })),
    notes: [
      "Prices are standard short-context USD per 1M tokens; source retrieved 2026-10-31.",
      "inputTokens includes cachedInputTokens. reasoningTokens is the API's output_tokens_details.reasoning_tokens subset of outputTokens; do not add it again when calculating cost. API reference: https://developers.openai.com/api/docs/guides/reasoning#managing-the-context-window",
      "Embedding usage reports prompt_tokens only. Its absent cached-input, output, and reasoning counts remain null; cost uses the verified input-only price.",
      "App Server rows aggregate the delta of thread/tokenUsage/updated cumulative totals over one turn; a turn without a usage notification has null counts and unknown cost.",
      "Cache hits are excluded. SDK-internal transport retries without a response usage object are not separately observable.",
      "Stages with no real call are listed separately in unmeasuredStages, never assigned guessed token counts or costs. --fresh bypasses reader, grading, coding, benchmark, and embedding caches, but existing dimension/scenario generation caches may still be reused.",
      "readers counts unique scenario.created IDs, not repeated readings. wallSeconds spans the first through last domain event of the run.",
      "A null stage token total indicates at least one unreported value; totalCostUsd is null if any call's billable usage is unknown, while measuredCostUsd retains the known subtotal.",
    ],
  };
}

function main(): void {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { "run-id": { type: "string" }, output: { type: "string", default: "docs/usage-probe.json" } },
  });
  const file = positionals[0];
  if (!file) throw new Error("usage: npx tsx scripts/usage-summary.ts <usage.jsonl> [--run-id id] [--output docs/usage-probe.json]");
  const runId = values["run-id"] ?? path.basename(path.dirname(path.resolve(file)));
  const usage = readFileSync(file, "utf8").split("\n").flatMap((line, index) => {
    if (line.trim() === "") return [];
    try { return [UsageEvent.parse(JSON.parse(line))]; }
    catch (error) { throw new Error(`${file}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`); }
  });
  if (usage.length === 0) throw new Error(`No API usage events in ${file}`);
  const events = readEvents(runId);
  const readers = new Set(events.flatMap((event) => event.type === "scenario.created" ? [event.payload.scenario.id] : [])).size;
  const first = events[0];
  const last = events.at(-1);
  if (!first || !last) throw new Error(`No domain events for ${runId}`);
  const summary = summarizeUsage(usage, runId, readers, (Date.parse(last.ts) - Date.parse(first.ts)) / 1_000);
  const output = values.output ?? "docs/usage-probe.json";
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(`${output}: ${usage.length} real calls, ${readers} scenarios, ${summary.wallSeconds}s, $${summary.totalCostUsd ?? "unknown"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
