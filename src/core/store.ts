/**
 * Run storage: `runs/<runId>/events.jsonl`, append-only, one validated event per line.
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, unlinkSync, watch } from "node:fs";
import path from "node:path";
import { EVENT_PAYLOADS, parseEvent, type EventPayload, type EventType, type RunEvent, type RunSummary } from "../shared/events";
import { RUNS_DIR } from "./paths";

const WRITER_LOCK_WAIT = new Int32Array(new SharedArrayBuffer(4));

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

/**
 * Appends contiguous events under a cross-process lock. A writer never reserves a
 * sequence number across an await; cached positions are revalidated inside append.
 * A busy/stale lock fails explicitly after five seconds rather than risking the log.
 */
export class RunWriter {
  readonly runId: string;
  readonly file: string;
  readonly #runsDir: string;
  #nextSeq = 0;
  #knownSize = -1;

  constructor(runId: string, runsDir = RUNS_DIR) {
    this.runId = runId;
    this.file = eventsPath(runId, runsDir);
    this.#runsDir = runsDir;
    mkdirSync(path.dirname(this.file), { recursive: true });
  }

  append<T extends EventType>(type: T, payload: EventPayload<T>): RunEvent;
  append<T extends EventType>(type: T, payload: EventPayload<T>, condition: (events: readonly RunEvent[]) => boolean): RunEvent | null;
  /** The optional synchronous predicate is rechecked inside the same append lock. */
  append<T extends EventType>(type: T, payload: EventPayload<T>, condition?: (events: readonly RunEvent[]) => boolean): RunEvent | null {
    const parsedPayload = EVENT_PAYLOADS[type].parse(payload);
    const lockPath = `${this.file}.lock`;
    const deadline = Date.now() + 5_000;
    let lock: number | null = null;
    while (lock === null) {
      try { lock = openSync(lockPath, "wx"); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        if (Date.now() >= deadline) throw new Error(`run log writer lock is busy: ${lockPath}`);
        Atomics.wait(WRITER_LOCK_WAIT, 0, 0, 10);
      }
    }
    try {
      const size = existsSync(this.file) ? statSync(this.file).size : 0;
      const current = condition || size !== this.#knownSize
        ? (size === 0 ? [] : readEvents(this.runId, this.#runsDir))
        : null;
      if (current) {
        const last = current.at(-1);
        this.#nextSeq = last === undefined ? 0 : last.seq + 1;
        this.#knownSize = size;
      }
      if (condition && !condition(current ?? [])) return null;
      const event = parseEvent({
        seq: this.#nextSeq, ts: new Date().toISOString(), runId: this.runId, type, payload: parsedPayload,
      });
      const line = `${JSON.stringify(event)}\n`;
      appendFileSync(this.file, line, "utf8");
      this.#knownSize = size + Buffer.byteLength(line, "utf8");
      this.#nextSeq = event.seq + 1;
      return event;
    } finally {
      try { closeSync(lock); }
      finally { unlinkSync(lockPath); }
    }
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
      const last = events.findLast((event) => event.type === "run.started" || event.type === "run.completed" || event.type === "run.failed");
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
  // Raw bytes after the last complete line: a write may end inside a multi-byte UTF-8 character.
  let pending = Buffer.alloc(0);
  let next = fromSeq;
  const pump = () => {
    if (!existsSync(file)) return;
    const size = statSync(file).size;
    if (size <= offset) return;
    const fresh = Buffer.alloc(size - offset);
    const fd = openSync(file, "r");
    try {
      readSync(fd, fresh, 0, fresh.length, offset);
    } finally {
      closeSync(fd);
    }
    offset = size;
    const bytes = pending.length === 0 ? fresh : Buffer.concat([pending, fresh]);
    const end = bytes.lastIndexOf(0x0a);
    if (end < 0) {
      pending = bytes;
      return;
    }
    pending = bytes.subarray(end + 1);
    for (const line of bytes.subarray(0, end).toString("utf8").split("\n")) {
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
