import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eventsPath, readEvents, RunWriter } from "../src/core/store";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "pwt-store-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("RunWriter", () => {
  it("continues the sequence when a run is reopened", () => {
    const first = new RunWriter("r1", dir);
    first.append("log", { level: "info", message: "a" });
    first.append("log", { level: "info", message: "b" });
    const reopened = new RunWriter("r1", dir);
    const event = reopened.append("run.completed", { summary: "done" });
    expect(event.seq).toBe(2);
    expect(readEvents("r1", dir).map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it("refuses an invalid payload and writes nothing", () => {
    const writer = new RunWriter("r2", dir);
    writer.append("log", { level: "info", message: "ok" });
    // @ts-expect-error: deliberately invalid payload
    expect(() => writer.append("log", { level: "loud", message: "x" })).toThrow();
    expect(readFileSync(eventsPath("r2", dir), "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("reports the line number of a corrupt event", () => {
    const writer = new RunWriter("r3", dir);
    writer.append("log", { level: "info", message: "ok" });
    appendFileSync(eventsPath("r3", dir), `${JSON.stringify({ seq: 1, ts: "t", runId: "r3", type: "nope", payload: {} })}\n`);
    expect(() => readEvents("r3", dir)).toThrow(/events\.jsonl:2: invalid event/);
  });
});
