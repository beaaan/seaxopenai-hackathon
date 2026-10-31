import { z } from "zod";
import { parseEvent, RunSummary, type RunEvent } from "@shared/events";
import { FolkFile, HumanQuestion, PolicyPackage, PolicyVersion, type Surface } from "@shared/schema";

async function call<T>(url: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text();
    let message = text;
    try {
      message = z.object({ error: z.string() }).parse(JSON.parse(text)).error;
    } catch {
      // not a JSON error body; keep the raw text
    }
    throw new Error(message || `${res.status} ${res.statusText}`);
  }
  return schema.parse(await res.json());
}

const RunCreated = z.strictObject({ runId: z.string() });
const Ok = z.strictObject({ ok: z.literal(true) });
export const PolicyDetail = z.strictObject({ package: PolicyPackage, version: PolicyVersion, hasReference: z.boolean(), folk: FolkFile });
export type PolicyDetail = z.infer<typeof PolicyDetail>;
export const HumanCheck = z.strictObject({ policy: PolicyVersion, questions: z.array(HumanQuestion) });
export type HumanCheck = z.infer<typeof HumanCheck>;

const id = encodeURIComponent;

export const api = {
  runs: () => call("/api/runs", z.array(RunSummary)),
  events: async (runId: string): Promise<RunEvent[]> => (await call(`/api/runs/${id(runId)}/events`, z.array(z.unknown()))).map(parseEvent),
  policy: (policyId: string) => call(`/api/policies/${id(policyId)}`, PolicyDetail),
  createPolicy: (title: string, text: string) => call("/api/policies", z.strictObject({ id: z.string() }), { title, text }),
  startRun: (policyId: string, mode: "full" | "explore", budget: number) => call("/api/runs", RunCreated, { policyId, mode, budget }),
  retest: (runId: string, surfaces: Surface[], smoke: boolean) => call(`/api/runs/${id(runId)}/retest`, RunCreated, { surfaces, smoke }),
  check: (runId: string) => call(`/api/runs/${id(runId)}/check`, HumanCheck),
  answer: (runId: string, respondentId: string, respondent: string, answers: Array<{ questionId: string; answerVi: string }>) =>
    call(`/api/runs/${id(runId)}/check/answers`, Ok, { respondentId, respondent, answers }),
  mapAnswers: (runId: string) => call(`/api/runs/${id(runId)}/check/map`, Ok, {}),
  approve: (runId: string, version: number, approvedBy: string) => call(`/api/runs/${id(runId)}/approve`, Ok, { version, approvedBy }),
};

/** Live tail over SSE from `from` (inclusive). Returns an unsubscribe function. */
export function tail(runId: string, from: number, onEvent: (event: RunEvent) => void): () => void {
  const source = new EventSource(`/api/runs/${id(runId)}/stream?from=${from}`);
  source.addEventListener("run-event", (msg) => onEvent(parseEvent(JSON.parse((msg as MessageEvent<string>).data))));
  return () => source.close();
}
