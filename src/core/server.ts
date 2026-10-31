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
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { RunEvent } from "../shared/events";
import { z } from "zod";
import { PolicyPackage, Surface, type FolkFile, type PolicyVersion } from "../shared/schema";
import { listPolicyIds, loadFolk, loadPolicyPackage, loadReference, versionZero } from "./policy";
import { RunWriter, listRuns, readEvents, tailEvents } from "./store";
import { POLICIES_DIR, REPO_ROOT, RUNS_DIR } from "./paths";

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
const AnswersRequest = z.strictObject({
  respondent: z.string().trim().min(1),
  answers: z.array(z.strictObject({ questionId: z.string().min(1), answerVi: z.string().trim().min(1) })).min(1),
});
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

async function launchCli(args: string[]): Promise<void> {
  const child = spawn(process.execPath, [path.join(REPO_ROOT, "node_modules/tsx/dist/cli.mjs"), "src/cli.ts", ...args], {
    cwd: REPO_ROOT, detached: true, stdio: "ignore",
  });
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  child.once("error", reject);
  child.once("spawn", resolve);
  await promise;
  child.unref();
}

export function createApp(): Hono {
  const app = new Hono();
  const writers = new Map<string, { writer: RunWriter; nextSeq: number }>();
  const writerFor = (runId: string, eventCount: number): { writer: RunWriter; nextSeq: number } => {
    let entry = writers.get(runId);
    // A detached map-human process may have extended the log since the last POST.
    if (!entry || entry.nextSeq !== eventCount) {
      entry = { writer: new RunWriter(runId), nextSeq: eventCount };
      writers.set(runId, entry);
    }
    return entry;
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
    await launchCli(["run", body.policyId, "--run-id", runId, "--mode", body.mode, "--budget", String(body.budget), "--iterations", String(body.maxIterations)]);
    return c.json({ runId });
  });

  app.post("/api/runs/:runId/retest", async (c) => {
    const suiteRunId = c.req.param("runId");
    if (!RUN_ID.test(suiteRunId)) return c.json({ error: "bad run id" }, 400);
    const body = RetestRequest.parse(await c.req.json());
    let events: RunEvent[];
    try { events = readEvents(suiteRunId); }
    catch (error) { return c.json({ error: (error as Error).message }, 404); }
    if (!finished(events) || !events.some((event) => event.type === "iteration.completed") || !events.some((event) => event.type === "codebook.fixed")) return c.json({ error: "run has no completed frozen suite" }, 409);
    const runId = reserveRunId(`${suiteRunId}-rt`, true);
    const file = path.join(RUNS_DIR, runId, "surfaces.json");
    writeFileSync(file, `${JSON.stringify(body.surfaces, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await launchCli(["test", file, "--suite", suiteRunId, "--run-id", runId, ...(body.smoke ? ["--smoke"] : [])]);
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
    const body = AnswersRequest.parse(await c.req.json());
    let events: RunEvent[];
    try { events = readEvents(runId); }
    catch (error) { return c.json({ error: (error as Error).message }, 404); }
    if (!finished(events)) return c.json({ error: "run is not completed" }, 409);
    const questionIds = new Set(events.flatMap((event) => event.type === "human.question" ? [event.payload.question.id] : []));
    if (body.answers.some((answer) => !questionIds.has(answer.questionId))) return c.json({ error: "unknown question id" }, 400);
    if (new Set(body.answers.map((answer) => answer.questionId)).size !== body.answers.length) return c.json({ error: "duplicate question id" }, 400);
    const entry = writerFor(runId, events.length);
    for (const answer of body.answers) entry.nextSeq = entry.writer.append("human.answer", { answer: { ...answer, id: `ha-${randomUUID()}`, respondent: body.respondent } }).seq + 1;
    return c.json({ ok: true });
  });

  app.post("/api/runs/:runId/check/map", async (c) => {
    const runId = c.req.param("runId");
    if (!RUN_ID.test(runId)) return c.json({ error: "bad run id" }, 400);
    let events: RunEvent[];
    try { events = readEvents(runId); }
    catch (error) { return c.json({ error: (error as Error).message }, 404); }
    if (!finished(events)) return c.json({ error: "run is not completed" }, 409);
    await launchCli(["map-human", runId]);
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
    const entry = writerFor(runId, events.length);
    entry.nextSeq = entry.writer.append("rewrite.approved", body).seq + 1;
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
