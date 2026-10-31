import { z } from "zod";
import { parseEvent, RunSummary, type RunEvent } from "@shared/events";
import { HumanQuestion, PolicyVersion, type Surface } from "@shared/schema";

async function requestJson<T>(url: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return schema.parse(await res.json());
}

const RunCreated = z.strictObject({ runId: z.string() });
const Ok = z.strictObject({ ok: z.literal(true) });
export const HumanCheck = z.strictObject({ policy: PolicyVersion, questions: z.array(HumanQuestion) });
export type HumanCheck = z.infer<typeof HumanCheck>;

export function fetchRuns(): Promise<RunSummary[]> {
  return requestJson("/api/runs", z.array(RunSummary));
}

export async function fetchEvents(runId: string): Promise<RunEvent[]> {
  const values = await requestJson(`/api/runs/${encodeURIComponent(runId)}/events`, z.array(z.unknown()));
  return values.map(parseEvent);
}

export function createPolicy(title: string, text: string): Promise<{ id: string }> {
  return requestJson("/api/policies", z.strictObject({ id: z.string() }), { title, text });
}

export function startRun(policyId: string): Promise<{ runId: string }> {
  return requestJson("/api/runs", RunCreated, { policyId, mode: "explore", budget: 16 });
}

export function retestRun(runId: string, surfaces: Surface[], smoke: boolean): Promise<{ runId: string }> {
  return requestJson(`/api/runs/${encodeURIComponent(runId)}/retest`, RunCreated, { surfaces, smoke });
}

export function fetchHumanCheck(runId: string): Promise<HumanCheck> {
  return requestJson(`/api/runs/${encodeURIComponent(runId)}/check`, HumanCheck);
}

export function submitHumanAnswers(runId: string, respondent: string, answers: { questionId: string; answerVi: string }[]): Promise<{ ok: true }> {
  return requestJson(`/api/runs/${encodeURIComponent(runId)}/check/answers`, Ok, { respondent, answers });
}

export function mapHumanAnswers(runId: string): Promise<{ ok: true }> {
  return requestJson(`/api/runs/${encodeURIComponent(runId)}/check/map`, Ok, {});
}

export function approveVersion(runId: string, version: number): Promise<{ ok: true }> {
  return requestJson(`/api/runs/${encodeURIComponent(runId)}/approve`, Ok, { version, approvedBy: "PM" });
}

/** Live tail over SSE from `from` (inclusive). Returns an unsubscribe function. */
export function subscribeEvents(runId: string, from: number, onEvent: (event: RunEvent) => void, onError: (message: string) => void): () => void {
  const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream?from=${from}`);
  source.addEventListener("run-event", (msg) => {
    try {
      onEvent(parseEvent(JSON.parse((msg as MessageEvent<string>).data)));
    } catch (error) {
      onError(`Invalid run event: ${String(error)}`);
    }
  });
  source.addEventListener("error", () => {
    onError(source.readyState === EventSource.CLOSED ? "stream closed" : "stream reconnecting");
  });
  return () => source.close();
}
