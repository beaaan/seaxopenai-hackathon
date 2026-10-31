import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eventsPath, listRuns, readEvents, RunWriter } from "../src/core/store";

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

  it("keeps sequences contiguous when long-lived writers append in turn", () => {
    const first = new RunWriter("shared", dir);
    const second = new RunWriter("shared", dir);
    first.append("log", { level: "info", message: "reader started" });
    second.append("human.mapped", { mapping: { answerId: "a1", findingId: null, why: "unmatched" } });
    first.append("rewrite.approved", { version: 0, approvedBy: "human" });
    second.append("log", { level: "info", message: "mapping complete" });
    expect(readEvents("shared", dir).map((event) => event.seq)).toEqual([0, 1, 2, 3]);
  });

  it("rechecks conditional appends against other writers without reserving a sequence", () => {
    const first = new RunWriter("guarded", dir);
    const second = new RunWriter("guarded", dir);
    const payload = { mapping: { answerId: "a1", findingId: null, why: "unmatched" } };
    first.append("log", { level: "info", message: "start" });
    expect(first.append("human.mapped", payload, (events) => !events.some((event) => event.type === "human.mapped"))?.seq).toBe(1);
    expect(second.append("human.mapped", payload, (events) => !events.some((event) => event.type === "human.mapped"))).toBeNull();
    expect(second.append("log", { level: "info", message: "after skipped duplicate" }).seq).toBe(2);
    expect(readEvents("guarded", dir).map((event) => event.seq)).toEqual([0, 1, 2]);
  });

  it("keeps completed/failed status after post-run events", () => {
    const writer = new RunWriter("status", dir);
    writer.append("run.completed", { summary: "done" });
    writer.append("rewrite.approved", { version: 0, approvedBy: "human" });
    expect(listRuns(dir)[0]?.status).toBe("completed");
    writer.append("run.failed", { error: "mapping failed" });
    writer.append("log", { level: "warn", message: "details" });
    expect(listRuns(dir)[0]?.status).toBe("failed");
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
