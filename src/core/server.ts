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
 */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { RunEvent } from "../shared/events";
import type { FolkFile, PolicyPackage, PolicyVersion } from "../shared/schema";
import { listPolicyIds, loadFolk, loadPolicyPackage, loadReference, versionZero } from "./policy";
import { listRuns, readEvents, tailEvents } from "./store";

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

const RUN_ID = /^[\w.-]+$/;
const HEARTBEAT_MS = 15_000;

export function createApp(): Hono {
  const app = new Hono();

  app.get("/api/health", (c) => c.json({ ok: true }));

  app.get("/api/runs", (c) => c.json(listRuns()));

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
