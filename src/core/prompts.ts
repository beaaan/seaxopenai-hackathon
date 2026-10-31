/**
 * Prompts live in `prompts/<name>.md`. Placeholders are `{{name}}`; rendering fails
 * loudly on a missing variable or an unused one so prompt/code drift is caught early.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PROMPTS_DIR } from "./paths";

export function loadPrompt(name: string, dir = PROMPTS_DIR): string {
  const file = path.join(dir, `${name}.md`);
  try {
    return readFileSync(file, "utf8");
  } catch {
    throw new Error(`missing prompt: prompts/${name}.md`);
  }
}

export function renderPrompt(template: string, vars: Readonly<Record<string, string>>): string {
  const used = new Set<string>();
  const out = template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const value = vars[key];
    if (value === undefined) throw new Error(`prompt variable {{${key}}} has no value`);
    used.add(key);
    return value;
  });
  const unused = Object.keys(vars).filter((k) => !used.has(k));
  if (unused.length > 0) throw new Error(`prompt variables not used by template: ${unused.join(", ")}`);
  return out;
}

/** loadPrompt + renderPrompt. */
export function prompt(name: string, vars: Readonly<Record<string, string>> = {}): string {
  return renderPrompt(loadPrompt(name), vars);
}
