import type { z } from "zod";
import type { ThreadItemRecord } from "../../shared/schema";
import type { BackendName } from "../env";

export type Effort = "minimal" | "low" | "medium" | "high" | "xhigh";

/** Model ids available today (ChatGPT login and API): gpt-6.1-sol, gpt-6-astra, gpt-6-luna, gpt-6.1-terra. */
export type ModelId = "gpt-6.1-sol" | "gpt-6-astra" | "gpt-6-luna" | "gpt-6.1-terra" | (string & {});

export interface StructuredRequest<T> {
  /** Pipeline role, used for cache keys and logs: "reader", "grader", "judge", ... */
  role: string;
  /** Role prompt. Responses: `instructions`. App Server: `baseInstructions` (replaces the Codex prompt). */
  instructions: string;
  input: string;
  schema: z.ZodType<T>;
  /** Name sent with the JSON schema; [a-zA-Z0-9_-]. */
  schemaName: string;
  model: ModelId;
  effort: Effort;
  /** Skip the cache read (noise-band and live runs). The result is still cached. */
  fresh?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  input: z.ZodType;
  /** Result is JSON-serialised and returned to the model. Throwing returns `{error}` to the model. */
  handler: (args: unknown) => Promise<unknown>;
}

export interface AgentThreadOptions {
  role: ThreadItemRecord["role"];
  /** Human-readable label for the thread inspector, e.g. "Reviewer" or "Bà Lan, Hà Giang". */
  label: string;
  instructions: string;
  tools: ToolDef[];
  model: ModelId;
  effort: Effort;
  /** Persist the thread (App Server rollout) so it can be inspected after the run. */
  persist: boolean;
  onItem?: (record: ThreadItemRecord) => void;
}

export interface OutputSchema {
  schema: z.ZodType;
  name: string;
}

export interface TurnResult {
  threadId: string;
  /** Text of the last agent message; JSON when an output schema was given. */
  finalText: string;
  items: unknown[];
}

export interface AgentThread {
  readonly threadId: string;
  turn(input: string, output?: OutputSchema): Promise<TurnResult>;
  close(): Promise<void>;
}

export interface LlmBackend {
  readonly name: BackendName;
  structured<T>(req: StructuredRequest<T>): Promise<T>;
  agentThread(opts: AgentThreadOptions): Promise<AgentThread>;
  close(): Promise<void>;
}
