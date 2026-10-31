/**
 * Content-addressed cache: `cache/<aa>/<sha256>.json`. Identical requests replay
 * identical outputs, so dev reruns are free and replays are deterministic.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export function cacheKey(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export class LlmCache {
  readonly #dir: string;

  constructor(dir: string) {
    this.#dir = dir;
  }

  #file(key: string): string {
    return path.join(this.#dir, key.slice(0, 2), `${key}.json`);
  }

  get(key: string): unknown {
    const file = this.#file(key);
    if (!existsSync(file)) return undefined;
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  }

  set(key: string, value: unknown): void {
    const file = this.#file(key);
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value), "utf8");
    renameSync(tmp, file);
  }
}
