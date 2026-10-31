import { useEffect, useState } from "react";
import type { RunSummary } from "@shared/events";
import { api, tail } from "./api";
import { applyEvent, foldRun, type RunModel } from "./model";

/** Loads a run, folds it, and keeps following it over SSE while it is running. */
export function useRun(runId: string): { model: RunModel | null; error: string | null } {
  const [model, setModel] = useState<RunModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let stop: (() => void) | null = null;
    let frame = 0;
    let retry = 0;
    setModel(null);
    setError(null);
    const load = (attempt: number): void => {
      api.events(runId).then(
        (events) => {
          if (!alive) return;
          const live = foldRun(runId, events);
          setModel({ ...live });
          if (live.status !== "running") return;
          let last = events.at(-1)?.seq ?? -1;
          stop = tail(runId, last + 1, (event) => {
            if (event.seq <= last) return;
            last = event.seq;
            applyEvent(live, event);
            // Many events arrive in bursts; render at most once per frame.
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => alive && setModel({ ...live }));
          });
        },
        (err: unknown) => {
          if (!alive) return;
          // A just-launched run has no log for a few seconds.
          if (attempt < 20) retry = window.setTimeout(() => load(attempt + 1), 1500);
          else setError(err instanceof Error ? err.message : String(err));
        },
      );
    };
    load(0);
    return () => {
      alive = false;
      clearTimeout(retry);
      cancelAnimationFrame(frame);
      stop?.();
    };
  }, [runId]);
  return { model, error };
}
export function useRuns(refreshMs = 4000): RunSummary[] | null {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = (): void => {
      api.runs().then((all) => alive && setRuns(all), () => {});
    };
    load();
    const timer = setInterval(load, refreshMs);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [refreshMs]);
  return runs;
}

export function useHash(): string {
  const [hash, setHash] = useState(window.location.hash || "#/");
  useEffect(() => {
    const change = (): void => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  return hash;
}
