/**
 * HTTP API for the web UI. The UI never computes pipeline state itself: it reads
 * events from here (JSON for replay, SSE for live tails).
 *
 *   GET /api/health
 *   GET /api/runs                         → RunSummary[]
 *   GET /api/runs/:runId/events           → RunEvent[]
 *   GET /api/runs/:runId/stream?from=N    → SSE, event "run-event", data RunEvent (seq >= N)
 *   GET /api/policies                     → PolicyListItem[]
 *   GET /api/policies/:policyId           → PolicyDetail
 *   POST /api/policies                    → {id}; create a one-surface Vietnamese package
 *   POST /api/runs                        → {runId}; launch a full/explore run
 *   POST /api/runs/:runId/retest           → {runId}; launch policy CI
 *   GET /api/runs/:runId/check             → {policy, questions}
 *   POST /api/runs/:runId/check/answers    → {ok}; collect human answers
 *   POST /api/runs/:runId/check/map        → {ok}; map new answers
 *   POST /api/runs/:runId/approve          → {ok}; record approval of an existing version
 */
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { RunEvent } from "../shared/events";
import { z } from "zod";
import { PolicyPackage, Surface, type FolkFile, type PolicyVersion } from "../shared/schema";
import { HumanAnswersRequest } from "../shared/human";
import { listPolicyIds, loadFolk, loadPolicyPackage, loadReference, versionZero } from "./policy";
import { RunWriter, eventsPath, listRuns, readEvents, tailEvents } from "./store";
import { POLICIES_DIR, REPO_ROOT, RUNS_DIR } from "./paths";
import { preflightRetest } from "../pipeline/retest";

export interface PolicyListItem {
  id: string;
  title: string;
  surfaces: number;
  hasReference: boolean;
}

export interface PolicyDetail {
  package: PolicyPackage;
  version: PolicyVersion;
  hasReference: boolean;
  folk: FolkFile;
}

const RUN_ID = /^[a-zA-Z0-9][\w.-]*$/;
const HEARTBEAT_MS = 15_000;
const NewPolicy = z.strictObject({ title: z.string().trim().min(1), text: z.string().trim().min(1) });
const NewRun = z.strictObject({
  policyId: z.string().regex(RUN_ID), mode: z.enum(["full", "explore"]),
  budget: z.number().int().positive().default(50), maxIterations: z.number().int().nonnegative().default(3),
});
const RetestRequest = z.strictObject({ surfaces: z.array(Surface).min(1), smoke: z.boolean() });
const ApprovalRequest = z.strictObject({ version: z.number().int().nonnegative(), approvedBy: z.string().trim().min(1) });

function finished(events: RunEvent[]): boolean {
  return events.findLast((event) => event.type === "run.started" || event.type === "run.completed" || event.type === "run.failed")?.type === "run.completed";
}

function reserveRunId(base: string, numbered: boolean): string {
  mkdirSync(RUNS_DIR, { recursive: true });
  for (let n = numbered ? 1 : 0; ; n++) {
    const runId = n === 0 ? base : `${base}${numbered ? "" : "-"}${n}`;
    try { mkdirSync(path.join(RUNS_DIR, runId)); return runId; }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error; }
  }
}

/**
 * Starts a detached CLI job. A non-zero exit is published to the run's log (the UI only
 * watches the log): `run.failed` for run/test jobs that did not record a terminal event
 * themselves, an error `log` event for annotation jobs such as `map-human`.
 */
async function launchCli(runId: string, args: string[], writer: RunWriter, terminal: boolean): Promise<void> {
  const stderrPath = path.join(RUNS_DIR, runId, "stderr.log");
  const stderr = openSync(stderrPath, "a");
  try {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs"), "src/cli.ts", ...args], {
      cwd: REPO_ROOT, detached: true, stdio: ["ignore", "ignore", stderr],
    });
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    child.once("error", reject);
    child.once("spawn", resolve);
    child.once("exit", (code, signal) => {
      if (code === 0) return;
      const tail = existsSync(stderrPath) ? readFileSync(stderrPath, "utf8").slice(-600).trim() : "";
      const error = `${args[0]} exited (${code ?? signal})${tail ? `: ${tail}` : ""}`;
      if (!terminal) {
        writer.append("log", { level: "error", message: error });
        return;
      }
      const events = existsSync(eventsPath(runId)) ? readEvents(runId) : [];
      if (!events.some((event) => event.type === "run.completed" || event.type === "run.failed")) writer.append("run.failed", { error });
    });
    await promise;
    child.unref();
  } finally { closeSync(stderr); }
}

export function createApp(): Hono {
  const app = new Hono();
  const writers = new Map<string, RunWriter>();
  const writerFor = (runId: string): RunWriter => {
    let writer = writers.get(runId);
    if (!writer) {
      writer = new RunWriter(runId);
      writers.set(runId, writer);
    }
    return writer;
  };
  app.onError((error, c) => c.json({ error: error.message }, error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500));

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/runs", (c) => c.json(listRuns()));

  app.post("/api/runs", async (c) => {
    const body = NewRun.parse(await c.req.json());
    if (!listPolicyIds().includes(body.policyId)) return c.json({ error: `no such policy: ${body.policyId}` }, 404);
    loadPolicyPackage(body.policyId);
    const stamp = new Date().toISOString().replace(/\D/g, "");
    const runId = reserveRunId(`${body.policyId}-${stamp}`, false);
    await launchCli(runId, ["run", body.policyId, "--run-id", runId, "--mode", body.mode, "--budget", String(body.budget), "--iterations", String(body.maxIterations)], writerFor(runId), true);
    return c.json({ runId });
  });

  app.post("/api/runs/:runId/retest", async (c) => {
    const suiteRunId = c.req.param("runId");
    if (!RUN_ID.test(suiteRunId)) return c.json({ error: "bad run id" }, 400);
    const body = RetestRequest.parse(await c.req.json());
    if (!existsSync(eventsPath(suiteRunId))) return c.json({ error: `no such run: ${suiteRunId}` }, 404);
    try { preflightRetest({ suiteRunId, surfaces: body.surfaces, smoke: body.smoke }); }
    catch (error) { return c.json({ error: (error as Error).message }, 409); }
    const runId = reserveRunId(`${suiteRunId}-rt`, true);
    const file = path.join(RUNS_DIR, runId, "surfaces.json");
    writeFileSync(file, `${JSON.stringify(body.surfaces, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await launchCli(runId, ["test", file, "--suite", suiteRunId, "--run-id", runId, ...(body.smoke ? ["--smoke"] : [])], writerFor(runId), true);
    return c.json({ runId });
  });

  app.get("/api/runs/:runId/check", (c) => {
    const runId = c.req.param("runId");
    if (!RUN_ID.test(runId)) return c.json({ error: "bad run id" }, 400);
    let events: RunEvent[];
    try { events = readEvents(runId); }
    catch (error) { return c.json({ error: (error as Error).message }, 404); }
    const policy = events.find((event) => event.type === "policy.version" && event.payload.policy.version === 0);
    if (policy?.type !== "policy.version") return c.json({ error: "run has no published policy" }, 409);
    return c.json({ policy: policy.payload.policy, questions: events.flatMap((event) => event.type === "human.question" ? [event.payload.question] : []) });
  });

  app.post("/api/runs/:runId/check/answers", async (c) => {
    const runId = c.req.param("runId");
    if (!RUN_ID.test(runId)) return c.json({ error: "bad run id" }, 400);
    const body = HumanAnswersRequest.parse(await c.req.json());
    let events: RunEvent[];
    try { events = readEvents(runId); }
    catch (error) { return c.json({ error: (error as Error).message }, 404); }
    if (!finished(events)) return c.json({ error: "run is not completed" }, 409);
    const questionIds = new Set(events.flatMap((event) => event.type === "human.question" ? [event.payload.question.id] : []));
    if (body.answers.some((answer) => !questionIds.has(answer.questionId))) return c.json({ error: "unknown question id" }, 400);
    if (new Set(body.answers.map((answer) => answer.questionId)).size !== body.answers.length) return c.json({ error: "duplicate question id" }, 400);
    const writer = writerFor(runId);
    const respondentId = "respondentId" in body ? body.respondentId : randomUUID();
    for (const answer of body.answers) writer.append("human.answer", { answer: { ...answer, id: `ha-${randomUUID()}`, respondentId, respondent: body.respondent } });
    return c.json({ ok: true });
  });

  app.post("/api/runs/:runId/check/map", async (c) => {
    const runId = c.req.param("runId");
    if (!RUN_ID.test(runId)) return c.json({ error: "bad run id" }, 400);
    let events: RunEvent[];
    try { events = readEvents(runId); }
    catch (error) { return c.json({ error: (error as Error).message }, 404); }
    if (!finished(events)) return c.json({ error: "run is not completed" }, 409);
    await launchCli(runId, ["map-human", runId], writerFor(runId), false);
    return c.json({ ok: true });
  });

  app.post("/api/runs/:runId/approve", async (c) => {
    const runId = c.req.param("runId");
    if (!RUN_ID.test(runId)) return c.json({ error: "bad run id" }, 400);
    const body = ApprovalRequest.parse(await c.req.json());
    let events: RunEvent[];
    try { events = readEvents(runId); }
    catch (error) { return c.json({ error: (error as Error).message }, 404); }
    if (!finished(events)) return c.json({ error: "run is not completed" }, 409);
    if (!events.some((event) => event.type === "policy.version" && event.payload.policy.version === body.version)) return c.json({ error: "version is not a published or accepted policy version" }, 409);
    writerFor(runId).append("rewrite.approved", body);
    return c.json({ ok: true });
  });

  app.get("/api/runs/:runId/events", (c) => {
    const runId = c.req.param("runId");
    if (!RUN_ID.test(runId)) return c.json({ error: "bad run id" }, 400);
    try {
      return c.json(readEvents(runId));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 404);
    }
  });

  app.get("/api/runs/:runId/stream", (c) => {
    const runId = c.req.param("runId");
    if (!RUN_ID.test(runId)) return c.json({ error: "bad run id" }, 400);
    const from = Number.parseInt(c.req.query("from") ?? "0", 10) || 0;
    return streamSSE(c, async (stream) => {
      const queue: RunEvent[] = [];
      let wake: (() => void) | null = null;
      const stop = tailEvents(runId, from, (event) => {
        queue.push(event);
        wake?.();
      });
      stream.onAbort(stop);
      try {
        while (!stream.aborted) {
          const event = queue.shift();
          if (event) {
            await stream.writeSSE({ event: "run-event", id: String(event.seq), data: JSON.stringify(event) });
            continue;
          }
          const { promise, resolve } = Promise.withResolvers<void>();
          wake = resolve;
          const heartbeat = setTimeout(resolve, HEARTBEAT_MS);
          await promise;
          clearTimeout(heartbeat);
          wake = null;
          if (queue.length === 0) await stream.writeSSE({ event: "ping", data: "" });
        }
      } finally {
        stop();
      }
    });
  });

  app.get("/api/policies", (c) =>
    c.json(
      listPolicyIds().map((id): PolicyListItem => {
        const pkg = loadPolicyPackage(id);
        return { id, title: pkg.title, surfaces: pkg.surfaces.length, hasReference: loadReference(id) !== null };
      }),
    ),
  );

  app.post("/api/policies", async (c) => {
    const body = NewPolicy.parse(await c.req.json());
    const id = body.title.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/gi, "d").toLowerCase()
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
    if (!id) return c.json({ error: "title must contain an ASCII-foldable letter or digit" }, 400);
    const policy = PolicyPackage.parse({
      id, title: body.title, lang: "vi", sourceUrls: [], retrievedAt: new Date().toISOString().slice(0, 10),
      surfaces: [{ id: "main", label: body.title, text: body.text }], notes: null,
    });
    mkdirSync(POLICIES_DIR, { recursive: true });
    const dir = path.join(POLICIES_DIR, id);
    try { mkdirSync(dir); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") return c.json({ error: `policy already exists: ${id}` }, 409);
      throw error;
    }
    writeFileSync(path.join(dir, "policy.json"), `${JSON.stringify(policy, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return c.json({ id });
  });

  app.get("/api/policies/:policyId", (c) => {
    const id = c.req.param("policyId");
    if (!listPolicyIds().includes(id)) return c.json({ error: `no such policy: ${id}` }, 404);
    const pkg = loadPolicyPackage(id);
    const detail: PolicyDetail = {
      package: pkg,
      version: versionZero(pkg),
      hasReference: loadReference(id) !== null,
      folk: loadFolk(id),
    };
    return c.json(detail);
  });

  return app;
}
