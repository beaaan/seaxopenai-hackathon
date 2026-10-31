/**
 * Run storage: `runs/<runId>/events.jsonl`, append-only, one validated event per line.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, watch } from "node:fs";
import path from "node:path";
import { EVENT_PAYLOADS, parseEvent, type EventPayload, type EventType, type RunEvent, type RunSummary } from "../shared/events";
import { RUNS_DIR } from "./paths";

export function eventsPath(runId: string, runsDir = RUNS_DIR): string {
  return path.join(runsDir, runId, "events.jsonl");
}

/** Parses every line; throws with the line number on the first invalid event. */
export function readEvents(runId: string, runsDir = RUNS_DIR): RunEvent[] {
  const file = eventsPath(runId, runsDir);
  if (!existsSync(file)) throw new Error(`no such run: ${runId} (${file})`);
  const lines = readFileSync(file, "utf8").split("\n");
  const events: RunEvent[] = [];
  lines.forEach((line, i) => {
    if (line.trim() === "") return;
    try {
      events.push(parseEvent(JSON.parse(line)));
    } catch (err) {
      throw new Error(`${file}:${i + 1}: invalid event: ${(err as Error).message}`);
    }
  });
  return events;
}

/** Appends validated events with a contiguous `seq`. Reopening an existing run continues its sequence. */
export class RunWriter {
  readonly runId: string;
  readonly file: string;
  #nextSeq: number;

  constructor(runId: string, runsDir = RUNS_DIR) {
    this.runId = runId;
    this.file = eventsPath(runId, runsDir);
    mkdirSync(path.dirname(this.file), { recursive: true });
    this.#nextSeq = existsSync(this.file) ? readEvents(runId, runsDir).length : 0;
  }

  append<T extends EventType>(type: T, payload: EventPayload<T>): RunEvent {
    const parsedPayload = EVENT_PAYLOADS[type].parse(payload);
    const event = parseEvent({
      seq: this.#nextSeq,
      ts: new Date().toISOString(),
      runId: this.runId,
      type,
      payload: parsedPayload,
    });
    appendFileSync(this.file, `${JSON.stringify(event)}\n`, "utf8");
    this.#nextSeq += 1;
    return event;
  }
}

export function listRuns(runsDir = RUNS_DIR): RunSummary[] {
  if (!existsSync(runsDir)) return [];
  return readdirSync(runsDir)
    .filter((name) => existsSync(eventsPath(name, runsDir)))
    .map((runId): RunSummary => {
      let events: RunEvent[];
      try {
        events = readEvents(runId, runsDir);
      } catch {
        return { runId, policyId: null, events: 0, startedAt: null, status: "unknown" };
      }
      const started = events.find((e) => e.type === "run.started");
      const last = events[events.length - 1];
      const status =
        last?.type === "run.completed" ? "completed" : last?.type === "run.failed" ? "failed" : started ? "running" : "unknown";
      return {
        runId,
        policyId: started?.type === "run.started" ? started.payload.config.policyId : null,
        events: events.length,
        startedAt: started?.ts ?? null,
        status,
      };
    })
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}

/**
 * Calls `onEvent` for every event with seq >= fromSeq, now and as the file grows.
 * Returns an unsubscribe function.
 */
export function tailEvents(runId: string, fromSeq: number, onEvent: (event: RunEvent) => void, runsDir = RUNS_DIR): () => void {
  const file = eventsPath(runId, runsDir);
  let offset = 0;
  let buffer = "";
  let next = fromSeq;
  const pump = () => {
    if (!existsSync(file)) return;
    const size = statSync(file).size;
    if (size <= offset) return;
    const chunk = readFileSync(file).subarray(offset, size).toString("utf8");
    offset = size;
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim() === "") continue;
      const event = parseEvent(JSON.parse(line));
      if (event.seq >= next) {
        next = event.seq + 1;
        onEvent(event);
      }
    }
  };
  pump();
  mkdirSync(path.dirname(file), { recursive: true });
  const watcher = watch(path.dirname(file), () => pump());
  const poll = setInterval(pump, 500); // fs.watch is unreliable on some Windows setups
  return () => {
    watcher.close();
    clearInterval(poll);
  };
}
