import { existsSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "./paths";

const envFile = path.join(REPO_ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

export type BackendName = "responses" | "appserver";

function backend(name: string, fallback: BackendName): BackendName {
  const value = process.env[name] ?? fallback;
  if (value !== "responses" && value !== "appserver") {
    throw new Error(`${name} must be "responses" or "appserver", got "${value}"`);
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return value;
}

export const config = {
  openaiApiKey: process.env.OPENAI_API_KEY ?? null,
  /** Readers, grader, judge, rewriter, fidelity, baseline, scorer. */
  bulkBackend: backend("LLM_BULK_BACKEND", "responses"),
  /** Reviewer, hero personas, probe persona. */
  agentBackend: backend("LLM_AGENT_BACKEND", "appserver"),
  responsesConcurrency: int("PWT_RESPONSES_CONCURRENCY", 16),
  appServerConcurrency: int("PWT_APPSERVER_CONCURRENCY", 10),
  turnTimeoutMs: int("PWT_TURN_TIMEOUT_MS", 120_000),
  codexCommand: process.env.PWT_CODEX_COMMAND ?? "codex",
  port: int("PORT", 8787),
} as const;
