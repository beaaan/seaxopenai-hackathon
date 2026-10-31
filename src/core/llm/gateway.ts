/**
 * The only entry point to models. Pipeline code calls `gateway.structured()`,
 * `gateway.embed()` and `gateway.agentThread()`; backends are chosen by call kind:
 *
 *   bulk structured calls → LLM_BULK_BACKEND  (default "responses")
 *   agent threads         → LLM_AGENT_BACKEND (default "appserver")
 *   embeddings            → always the Responses API (needs OPENAI_API_KEY)
 *   decisions             → always the Decisions API, gpt-6-luna (needs OPENAI_API_KEY)
 *
 * Structured results, decisions and embeddings are cached by content (see cache.ts).
 */
import { z } from "zod";
import { config, type BackendName } from "../env";
import { CACHE_DIR } from "../paths";
import { AppServerBackend } from "./appserver";
import { cacheKey, LlmCache } from "./cache";
import { DECISIONS_MODEL, DecisionAnswers, emulateDecisions, type DecisionAnswer, type DecisionRequest } from "./decisions";
import { llmJsonSchema } from "./json-schema";
import { EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, ResponsesBackend } from "./responses";
import type { AgentThread, AgentThreadOptions, LlmBackend, StructuredRequest } from "./types";

const CACHE_VERSION = 1;
const EmbeddingVector = z.array(z.number());

export interface GatewayOptions {
  bulk: BackendName;
  agent: BackendName;
  cacheDir: string;
}

export class Gateway {
  readonly #opts: GatewayOptions;
  readonly #cache: LlmCache;
  #responses: ResponsesBackend | null = null;
  #appServer: AppServerBackend | null = null;

  constructor(opts: Partial<GatewayOptions> = {}) {
    const hasKey = config.openaiApiKey !== null && config.openaiApiKey !== "";
    // Without an API key everything generative runs on Codex App Server (ChatGPT login).
    const pick = (name: BackendName): BackendName => (name === "responses" && !hasKey ? "appserver" : name);
    this.#opts = {
      bulk: pick(opts.bulk ?? config.bulkBackend),
      agent: pick(opts.agent ?? config.agentBackend),
      cacheDir: opts.cacheDir ?? CACHE_DIR,
    };
    this.#cache = new LlmCache(this.#opts.cacheDir);
  }

  get backends(): Readonly<Pick<GatewayOptions, "bulk" | "agent">> {
    return { bulk: this.#opts.bulk, agent: this.#opts.agent };
  }

  /** Embeddings and the real Decisions API need OPENAI_API_KEY; without it clustering uses LLM grouping and decide() is emulated. */
  get hasApiKey(): boolean {
    return config.openaiApiKey !== null && config.openaiApiKey !== "";
  }

  #responsesBackend(): ResponsesBackend {
    if (!this.#responses) {
      if (!config.openaiApiKey) throw new Error("OPENAI_API_KEY is not set (put it in .env); needed for the Responses backend and embeddings");
      this.#responses = new ResponsesBackend(config.openaiApiKey);
    }
    return this.#responses;
  }

  #backend(name: BackendName): LlmBackend {
    if (name === "responses") return this.#responsesBackend();
    this.#appServer ??= AppServerBackend.fromConfig();
    return this.#appServer;
  }

  async structured<T>(req: StructuredRequest<T>): Promise<T> {
    const key = cacheKey({
      v: CACHE_VERSION,
      kind: "structured",
      backend: this.#opts.bulk,
      replicate: req.replicate ?? null,
      role: req.role,
      model: req.model,
      effort: req.effort,
      instructions: req.instructions,
      input: req.input,
      schemaName: req.schemaName,
      schema: llmJsonSchema(req.schema),
    });
    if (!req.fresh) {
      const hit = this.#cache.get(key);
      if (hit !== undefined) return req.schema.parse(hit);
    }
    const result = await this.#backend(this.#opts.bulk).structured(req);
    this.#cache.set(key, result);
    return result;
  }

  /** Embeddings for clustering; cached per text. */
  async embed(texts: readonly string[]): Promise<number[][]> {
    const keys = texts.map((text) => cacheKey({ v: CACHE_VERSION, kind: "embed", model: EMBEDDING_MODEL, dims: EMBEDDING_DIMENSIONS, text }));
    const out: Array<number[] | undefined> = keys.map((key) => {
      const hit = this.#cache.get(key);
      return hit === undefined ? undefined : EmbeddingVector.parse(hit);
    });
    const missing = out.flatMap((vector, i) => (vector === undefined ? [i] : []));
    if (missing.length > 0) {
      const vectors = await this.#responsesBackend().embed(missing.map((i) => texts[i] ?? ""));
      missing.forEach((textIndex, j) => {
        const vector = vectors[j];
        if (!vector) throw new Error(`embeddings: missing vector ${j}`);
        out[textIndex] = vector;
        this.#cache.set(keys[textIndex] ?? "", vector);
      });
    }
    return out.map((vector, i) => {
      if (!vector) throw new Error(`embeddings: no vector for text ${i}`);
      return vector;
    });
  }

  /**
   * Typed answers (predicate / choice / score) about shared evidence via the Decisions API.
   * One answer per question, in question order; cached per request content.
   * Without OPENAI_API_KEY the answers are emulated with structured calls on the bulk
   * backend (model-reported probabilities; marked `emulated` in the cache key).
   */
  async decide(req: DecisionRequest): Promise<DecisionAnswer[]> {
    const emulated = !this.hasApiKey;
    const key = cacheKey({ v: CACHE_VERSION, kind: "decide", emulated, model: DECISIONS_MODEL, role: req.role, evidence: req.evidence, data: req.data, questions: req.questions });
    if (!req.fresh) {
      const hit = this.#cache.get(key);
      if (hit !== undefined) return DecisionAnswers.parse(hit);
    }
    const answers = emulated
      ? await emulateDecisions((r) => this.#backend(this.#opts.bulk).structured(r), req)
      : await this.#responsesBackend().decide(req);
    this.#cache.set(key, answers);
    return answers;
  }

  agentThread(opts: AgentThreadOptions): Promise<AgentThread> {
    return this.#backend(this.#opts.agent).agentThread(opts);
  }

  async close(): Promise<void> {
    await Promise.all([this.#responses?.close(), this.#appServer?.close()]);
  }
}
