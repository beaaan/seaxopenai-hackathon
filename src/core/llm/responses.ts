/**
 * OpenAI Responses API backend: bulk structured calls, embeddings, and a
 * function-calling agent loop (fallback for App Server agent threads).
 */
import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import type { ResponseCreateParamsNonStreaming, ResponseInputItem, Tool } from "openai/resources/responses/responses";
import { config } from "../env";
import { decideChunked, type DecisionAnswer, type DecisionRequest } from "./decisions";
import { llmJsonSchema } from "./json-schema";
import { Limiter } from "./limit";
import type { AgentThread, AgentThreadOptions, LlmBackend, OutputSchema, StructuredRequest, ToolDef, TurnResult } from "./types";

const MAX_TOOL_STEPS = 24;
export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 512;

function textFormat(name: string, schema: OutputSchema["schema"]): ResponseCreateParamsNonStreaming["text"] {
  return { format: { type: "json_schema", name, schema: llmJsonSchema(schema), strict: true } };
}

export async function runTool(tools: readonly ToolDef[], name: string, rawArgs: string): Promise<unknown> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { error: `unknown tool: ${name}` };
  try {
    const args = tool.input.parse(JSON.parse(rawArgs));
    return await tool.handler(args);
  } catch (err) {
    return { error: (err as Error).message };
  }
}

export class ResponsesBackend implements LlmBackend {
  readonly name = "responses" as const;
  readonly #client: OpenAI;
  readonly #limiter = new Limiter(config.responsesConcurrency);

  constructor(apiKey: string) {
    this.#client = new OpenAI({ apiKey, maxRetries: 4, timeout: config.turnTimeoutMs });
  }

  structured<T>(req: StructuredRequest<T>): Promise<T> {
    return this.#limiter.run(async () => {
      const res = await this.#client.responses.create({
        model: req.model,
        instructions: req.instructions,
        input: req.input,
        reasoning: { effort: req.effort },
        text: textFormat(req.schemaName, req.schema),
        store: false,
      });
      if (res.status !== "completed") {
        throw new Error(`responses ${req.role}: status ${res.status} ${JSON.stringify(res.incomplete_details ?? res.error)}`);
      }
      return req.schema.parse(JSON.parse(res.output_text));
    });
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 256) {
      const batch = texts.slice(i, i + 256);
      const res = await this.#limiter.run(() =>
        this.#client.embeddings.create({ model: EMBEDDING_MODEL, input: batch, dimensions: EMBEDDING_DIMENSIONS, encoding_format: "float" }),
      );
      for (const row of [...res.data].sort((a, b) => a.index - b.index)) out.push(row.embedding);
    }
    return out;
  }

  decide(req: DecisionRequest): Promise<DecisionAnswer[]> {
    return decideChunked((body) => this.#client.decisions.create(body), this.#limiter, req);
  }

  async agentThread(opts: AgentThreadOptions): Promise<AgentThread> {
    const client = this.#client;
    const limiter = this.#limiter;
    const threadId = `resp-${randomUUID()}`;
    const tools: Tool[] = opts.tools.map((t) => ({
      type: "function",
      name: t.name,
      description: t.description,
      parameters: llmJsonSchema(t.input),
      strict: true,
    }));
    let previousResponseId: string | null = null;

    const turn = async (input: string, output?: OutputSchema): Promise<TurnResult> => {
      const items: unknown[] = [];
      let next: ResponseInputItem[] = [{ role: "user", content: input }];
      for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
        const res = await limiter.run(() =>
          client.responses.create({
            model: opts.model,
            instructions: opts.instructions,
            input: next,
            previous_response_id: previousResponseId,
            tools,
            reasoning: { effort: opts.effort, summary: "auto" },
            text: output ? textFormat(output.name, output.schema) : undefined,
            store: true,
          }),
        );
        if (res.status !== "completed") {
          throw new Error(`agent thread ${opts.label}: status ${res.status} ${JSON.stringify(res.incomplete_details ?? res.error)}`);
        }
        previousResponseId = res.id;
        for (const item of res.output) {
          items.push(item);
          opts.onItem?.({ threadId, role: opts.role, label: opts.label, backend: "responses", itemType: item.type, item });
        }
        const calls = res.output.filter((item) => item.type === "function_call");
        if (calls.length === 0) return { threadId, finalText: res.output_text, items };
        next = await Promise.all(
          calls.map(async (call): Promise<ResponseInputItem> => ({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(await runTool(opts.tools, call.name, call.arguments)),
          })),
        );
      }
      throw new Error(`agent thread ${opts.label}: more than ${MAX_TOOL_STEPS} tool steps in one turn`);
    };

    return { threadId, turn, close: async () => {} };
  }

  async close(): Promise<void> {}
}
