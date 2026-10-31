import { fileURLToPath } from "node:url";
import path from "node:path";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const POLICIES_DIR = path.join(REPO_ROOT, "policies");
export const RUNS_DIR = path.join(REPO_ROOT, "runs");
export const CACHE_DIR = path.join(REPO_ROOT, "cache");
export const PROMPTS_DIR = path.join(REPO_ROOT, "prompts");
