import { rmSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const roots = vi.hoisted(() => ({ runsDir: `${process.env.TMPDIR ?? "/tmp"}/pwt-human-api-${process.pid}-${Date.now()}` }));
vi.mock("../src/core/paths", async (original) => ({ ...await original<typeof import("../src/core/paths")>(), RUNS_DIR: roots.runsDir }));

import { createApp } from "../src/core/server";
import { readEvents, RunWriter } from "../src/core/store";
import { latestHumanAnswers, pendingHumanAnswers } from "../src/shared/human";

let runId: string;
let nextRun = 0;
beforeEach(() => {
  runId = `human-${++nextRun}`;
  const writer = new RunWriter(runId);
  writer.append("human.question", { question: { id: "q1", questionVi: "What does the policy say?", findingIds: ["f1"] } });
  writer.append("run.completed", { summary: "ready" });
});
afterAll(() => rmSync(roots.runsDir, { recursive: true, force: true }));

const payload = { respondent: "ẩn danh", answers: [{ questionId: "q1", answerVi: "first answer" }] };
const post = (body: unknown) => createApp().request(`/api/runs/${runId}/check/answers`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const answers = () => readEvents(runId).flatMap((event) => event.type === "human.answer" ? [event.payload.answer] : []);

describe("human-answer HTTP boundary", () => {
  it("assigns separate IDs to old clients submitting the same anonymous name", async () => {
    expect((await post(payload)).status).toBe(200);
    expect((await post(payload)).status).toBe(200);
    const saved = answers();
    expect(saved).toHaveLength(2);
    expect(saved[0]!.respondentId).not.toBeNull();
    expect(saved[0]!.respondentId).not.toBe(saved[1]!.respondentId);
    expect(latestHumanAnswers(saved)).toHaveLength(2);
  });

  it("appends corrections for a modern participant and leaves the latest revision pending", async () => {
    const respondentId = "781bdc4a-d44c-41a3-83ed-2bd2e8eeecda";
    expect((await post({ ...payload, respondentId })).status).toBe(200);
    const old = answers()[0]!;
    const mapping = { answerId: old.id, findingId: "f1", why: "old answer" };
    new RunWriter(runId).append("human.mapped", { mapping });
    expect((await post({ ...payload, respondentId, respondent: "Minh", answers: [{ questionId: "q1", answerVi: "corrected answer" }] })).status).toBe(200);
    const saved = answers();
    expect(saved).toHaveLength(2);
    expect(new Set(saved.map((answer) => answer.respondentId)).size).toBe(1);
    expect(pendingHumanAnswers(saved, [mapping])).toEqual([saved[1]]);
    expect(saved[1]!.answerVi).toBe("corrected answer");
  });

  it("rejects malformed IDs and duplicate questions without recording answers", async () => {
    expect((await post({ ...payload, respondentId: "invalid" })).status).toBe(400);
    expect((await post({ ...payload, answers: [payload.answers[0], payload.answers[0]] })).status).toBe(400);
    expect(answers()).toEqual([]);
  });
});
