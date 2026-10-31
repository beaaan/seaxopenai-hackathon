import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { RunWriter, readEvents } from "../src/core/store";
import { parseEvent } from "../src/shared/events";
import { HumanAnswersRequest, canMapHumanAnswer, currentHumanResults, humanRespondentId, humanRespondentKey, latestHumanAnswers, pendingHumanAnswers, type HumanIdentityStorage } from "../src/shared/human";
import type { HumanAnswer, HumanMapping } from "../src/shared/schema";

const person1 = "781bdc4a-d44c-41a3-83ed-2bd2e8eeecda";
const person2 = "59effae4-ccaf-409c-a078-9d603b0a02a8";
const answer = (id: string, respondentId = person1, respondent = "ẩn danh"): HumanAnswer => ({ id, respondentId, respondent, questionId: "q1", answerVi: id });
const mapping = (id: string): HumanMapping => ({ answerId: id, findingId: "f1", why: "observed" });

describe("participant identity and answer revisions", () => {
  it.each(["ẩn danh", "Minh"])("keeps two people named %s distinct", (name) => {
    const answers = [answer("a1", person1, name), answer("a2", person2, name)];
    expect(new Set(answers.map(humanRespondentKey)).size).toBe(2);
    expect(latestHumanAnswers(answers)).toHaveLength(2);
    expect(pendingHumanAnswers(answers, [mapping("a1")]).map((a) => a.id)).toEqual(["a2"]);
  });

  it("remaps a corrected answer without counting its old revision or mapping", () => {
    const answers = [answer("old"), answer("new", person1, "Changed name")];
    expect(latestHumanAnswers(answers).map((a) => a.id)).toEqual(["new"]);
    expect(pendingHumanAnswers(answers, [mapping("old")]).map((a) => a.id)).toEqual(["new"]);
    expect(canMapHumanAnswer(answers[0]!, answers, [])).toBe(false);
    expect(canMapHumanAnswer(answers[1]!, answers, [mapping("old")])).toBe(true);
    expect(canMapHumanAnswer(answers[1]!, answers, [mapping("old"), mapping("new")])).toBe(false);
  });

  it("reads historical events without rewriting them or inferring participant UUIDs", () => {
    const legacy = { seq: 0, ts: "t", runId: "r", type: "human.answer", payload: { answer: { id: "old", respondent: "Minh", questionId: "q1", answerVi: "text" } } };
    const event = parseEvent(legacy);
    if (event.type !== "human.answer") throw new Error("wrong event type");
    expect(event.payload.answer.respondentId).toBeNull();
    expect(legacy.payload.answer).not.toHaveProperty("respondentId");
    expect(humanRespondentKey(event.payload.answer)).not.toBe(humanRespondentKey(answer("new", person1, "Minh")));
  });

  it("validates modern identities while still accepting the old submission shape", () => {
    const body = { respondent: "ẩn danh", answers: [{ questionId: "q1", answerVi: "text" }] };
    expect(HumanAnswersRequest.parse({ ...body, respondentId: person1 })).toHaveProperty("respondentId", person1);
    expect(HumanAnswersRequest.parse(body)).toEqual(body);
    expect(() => HumanAnswersRequest.parse({ ...body, respondentId: "not-an-id" })).toThrow();
    expect(() => HumanAnswersRequest.parse({ ...body, respondentId: null })).toThrow();
  });

  it("rechecks latest revisions under the event writer lock after another writer changes the answers", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pwt-human-identity-"));
    try {
      const first = new RunWriter("check", dir);
      const second = new RunWriter("check", dir);
      first.append("human.answer", { answer: answer("old") });
      second.append("human.answer", { answer: answer("new") });
      const append = (writer: RunWriter, candidate: HumanAnswer) => writer.append("human.mapped", { mapping: mapping(candidate.id) }, (events) => canMapHumanAnswer(candidate,
        events.flatMap((event) => event.type === "human.answer" ? [event.payload.answer] : []),
        events.flatMap((event) => event.type === "human.mapped" ? [event.payload.mapping] : [])));
      expect(append(first, answer("old"))).toBeNull();
      expect(append(first, answer("new"))?.type).toBe("human.mapped");
      expect(append(second, answer("new"))).toBeNull();
      expect(readEvents("check", dir).map((event) => event.seq)).toEqual([0, 1, 2]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("current human report evidence", () => {
  it.each(["f2", null])("uses the last mapping of the current answer (%s), ignoring old and orphan mappings", (findingId) => {
    const answers = Object.freeze([answer("old"), answer("new")]);
    const mappings = Object.freeze([mapping("old"), mapping("missing"), mapping("new"), { ...mapping("new"), findingId }]);
    const snapshot = JSON.stringify({ answers, mappings });
    const current = currentHumanResults(answers, mappings);
    expect(current.answers.map((a) => a.id)).toEqual(["new"]);
    expect([...current.mappingsByAnswerId.keys()]).toEqual(["new"]);
    expect(current.mappingsByAnswerId.get("new")?.findingId).toBe(findingId);
    expect([...current.peopleByFindingId]).toEqual(findingId === null ? [] : [["f2", 1]]);
    expect(JSON.stringify({ answers, mappings })).toBe(snapshot);
  });

  it("retains the legacy name fallback separately from modern participant IDs", () => {
    const legacy = { ...answer("legacy-old", person1, "Minh"), respondentId: null };
    const answers = [legacy, { ...legacy, id: "legacy-new" }, answer("modern", person1, "Minh")];
    const current = currentHumanResults(answers, answers.map((a) => mapping(a.id)));
    expect(current.answers.map((a) => a.id)).toEqual(["legacy-new", "modern"]);
    expect(current.peopleByFindingId.get("f1")).toBe(2);
  });
});

describe("phone identity persistence", () => {
  function storage(): HumanIdentityStorage {
    const values = new Map<string, string>();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  }
  it("persists through reloads, isolates runs and devices, and supports a new person on one device", () => {
    const local = storage();
    const id = humanRespondentId("r1", local);
    expect(z.string().uuid().parse(id)).toBe(id);
    expect(humanRespondentId("r1", local)).toBe(id);
    expect(humanRespondentId("r2", local)).not.toBe(id);
    expect(humanRespondentId("r1", storage())).not.toBe(id);
    const next = humanRespondentId("r1", local, true);
    expect(next).not.toBe(id);
    expect(humanRespondentId("r1", local)).toBe(next);
  });
  it("works with unavailable storage and replaces malformed saved identities", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(z.string().uuid().safeParse(humanRespondentId("r1", blocked)).success).toBe(true);
    const local = storage();
    local.setItem("pwt-human-v1:r1", "broken");
    expect(z.string().uuid().safeParse(humanRespondentId("r1", local)).success).toBe(true);
  });
});
