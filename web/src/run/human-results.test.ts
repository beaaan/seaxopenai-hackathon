import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Finding, HumanAnswer, HumanMapping } from "@shared/schema";
import { applyEvent, emptyRun, type RunModel } from "../model";
import { Findings } from "./Findings";
import { HumanCheck } from "./HumanCheck";

const person1 = "781bdc4a-d44c-41a3-83ed-2bd2e8eeecda";
const person2 = "59effae4-ccaf-409c-a078-9d603b0a02a8";
const answer = (id: string, overrides: Partial<HumanAnswer> = {}): HumanAnswer => ({
  id, respondentId: person1, respondent: "Minh", questionId: "q1", answerVi: id, ...overrides,
});
const finding: Finding = {
  id: "f1", title: "Test finding", sentenceIds: [], readingSummary: "A misreading", plausibility: "", dimsAssociated: [],
  conflictsReference: false, factIds: [], class: "wording_fix", classRationale: "", repair: null,
  evidence: { clusterIds: ["c1"], scenarioIds: [], readingIds: [] },
};

function model(): RunModel {
  const result = emptyRun("human-report-test");
  result.findings = [finding];
  result.questions = [{ id: "q1", questionVi: "First question", findingIds: ["f1"] }];
  return result;
}

function addAnswer(run: RunModel, value: HumanAnswer): void {
  applyEvent(run, { runId: run.runId, seq: run.events, ts: "2026-10-31T00:00:00Z", type: "human.answer", payload: { answer: value } });
}

function addMapping(run: RunModel, answerId: string, findingId: string | null = "f1"): void {
  const mapping: HumanMapping = { answerId, findingId, why: "Test coding" };
  applyEvent(run, { runId: run.runId, seq: run.events, ts: "2026-10-31T00:00:00Z", type: "human.mapped", payload: { mapping } });
}

function reportText(run: RunModel): { findings: string; human: string } {
  const props = { ctx: { model: run, policy: null } };
  const text = (html: string): string => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return {
    findings: text(renderToStaticMarkup(createElement(Findings, props))),
    human: text(renderToStaticMarkup(createElement(HumanCheck, props))),
  };
}

beforeEach(() => vi.stubGlobal("window", { location: { origin: "http://localhost:5173" } }));
afterEach(() => vi.unstubAllGlobals());

describe("human evidence across the Findings and Human Check screens", () => {
  it("removes old support while a correction is pending and counts the remapped correction once", () => {
    const run = model();
    addAnswer(run, answer("superseded-answer"));
    addMapping(run, "superseded-answer");
    expect(reportText(run).findings).toContain("1 real person read it this way");

    addAnswer(run, answer("corrected-answer"));
    const pending = reportText(run);
    expect(pending.findings).not.toContain("read it this way");
    expect(pending.human).toContain("Code 1 new answer");
    expect(pending.human).toContain("0 of 0 coded answers match");
    expect(pending.human).not.toContain("superseded-answer");

    addMapping(run, "corrected-answer");
    const current = reportText(run);
    expect(current.findings).toContain("1 real person read it this way");
    expect(current.findings).not.toContain("2 real people");
    expect(current.human).toContain("1 of 1 coded answers match");
    expect(current.human).toContain("People 1 Answers 1");
    // Projection must leave both revisions in the audit history.
    expect(run.answers).toHaveLength(2);
    expect(run.mappings).toHaveLength(2);
  });

  it("withdraws support when the correction no longer matches a finding", () => {
    const run = model();
    addAnswer(run, answer("old-answer"));
    addMapping(run, "old-answer");
    addAnswer(run, answer("corrected-answer"));
    addMapping(run, "corrected-answer", null);
    const current = reportText(run);
    expect(current.findings).not.toContain("read it this way");
    expect(current.human).toContain("0 of 1 coded answers match");
    expect(current.human).toContain("No listed misreading");
  });

  it("moves current support to a different finding", () => {
    const run = model();
    const secondFinding = { ...finding, id: "f2", title: "Another finding" };
    run.findings.push(secondFinding);
    addAnswer(run, answer("old-answer"));
    addMapping(run, "old-answer");
    addAnswer(run, answer("corrected-answer"));
    addMapping(run, "corrected-answer", "f2");
    expect(reportText(run).findings).not.toContain("read it this way");
    // With equal reader counts, the first finding is selected by default.
    const current = reportText({ ...run, findings: [secondFinding, finding] });
    expect(current.findings).toContain("1 real person read it this way");
    expect(current.human).toContain("Matches: Another finding");
    expect(current.human).toContain("1 of 1 coded answers match");
  });

  it("counts a participant once per finding while retaining separate coded-answer totals", () => {
    const run = model();
    run.questions.push({ id: "q2", questionVi: "Second question", findingIds: ["f1"] });
    addAnswer(run, answer("first-answer"));
    addAnswer(run, answer("second-answer", { questionId: "q2" }));
    addMapping(run, "first-answer");
    addMapping(run, "second-answer");
    const current = reportText(run);
    expect(current.findings).toContain("1 real person read it this way");
    expect(current.human).toContain("People 1 Answers 2");
    expect(current.human).toContain("2 of 2 coded answers match");
  });

  it.each(["ẩn danh", "Minh"])("counts separate participants named %s separately", (respondent) => {
    const run = model();
    addAnswer(run, answer("first-answer", { respondent }));
    addAnswer(run, answer("second-answer", { respondent, respondentId: person2 }));
    addMapping(run, "first-answer");
    addMapping(run, "second-answer");
    const current = reportText(run);
    expect(current.findings).toContain("2 real people read it this way");
    expect(current.human).toContain("People 2 Answers 2");
    expect(current.human).toContain("2 of 2 coded answers match");
  });
});
