import type { RunEvent, RunSummary } from "@shared/events";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export function fetchRuns(): Promise<RunSummary[]> {
  return getJson<RunSummary[]>("/api/runs");
}

export function fetchEvents(runId: string): Promise<RunEvent[]> {
  return getJson<RunEvent[]>(`/api/runs/${encodeURIComponent(runId)}/events`);
}

/** Live tail over SSE from `from` (inclusive). Returns an unsubscribe function. */
export function subscribeEvents(runId: string, from: number, onEvent: (event: RunEvent) => void, onError: (message: string) => void): () => void {
  const source = new EventSource(`/api/runs/${encodeURIComponent(runId)}/stream?from=${from}`);
  source.addEventListener("run-event", (msg) => {
    onEvent(JSON.parse((msg as MessageEvent<string>).data) as RunEvent);
  });
  source.addEventListener("error", () => {
    onError(source.readyState === EventSource.CLOSED ? "stream closed" : "stream reconnecting");
  });
  return () => source.close();
}
