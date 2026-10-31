/**
 * Leak guard for the evaluation holdout. Fails (exit 1) when anything outside
 * src/eval reads the holdout file or imports the holdout loader, or when a prompt
 * mentions the holdout at all.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../src/core/paths";

const CODE_ROOTS = ["src", "web/src", "scripts"];
const PROMPT_ROOT = "prompts";
const ALLOWED = [path.join("src", "eval") + path.sep, path.join("scripts", "holdout-guard.ts")];
const CODE_PATTERN = /holdout\.json|from\s+["'][^"']*eval\/holdout["']|import\(\s*["'][^"']*eval\/holdout["']/;
const PROMPT_PATTERN = /holdout/i;

function walk(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const violations: string[] = [];

for (const root of CODE_ROOTS) {
  for (const file of walk(path.join(REPO_ROOT, root))) {
    const rel = path.relative(REPO_ROOT, file);
    if (!/\.(ts|tsx|js|mjs)$/.test(rel) || ALLOWED.some((allowed) => rel.startsWith(allowed) || rel === allowed)) continue;
    readFileSync(file, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (CODE_PATTERN.test(line)) violations.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
  }
}

for (const file of walk(path.join(REPO_ROOT, PROMPT_ROOT))) {
  const rel = path.relative(REPO_ROOT, file);
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (PROMPT_PATTERN.test(line)) violations.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
}

if (violations.length > 0) {
  console.error("holdout guard: only src/eval may touch the holdout, and prompts may not mention it:");
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
console.log("holdout guard: ok");
