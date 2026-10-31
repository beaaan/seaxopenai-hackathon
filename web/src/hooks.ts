import { useEffect, useState } from "react";
import type { RunEvent, RunSummary } from "@shared/events";
import { api, tail } from "./api";
import { applyEvent, foldRun, type RunModel } from "./model";

export interface LoadedRun {
  model: RunModel | null;
  /** Every event so far, in order (for replay). */
  events: readonly RunEvent[];
  error: string | null;
}

/**
 * Loads a run, folds it, and keeps following it over SSE. A finished run still gains events (human answers, their
 * coding, approvals), so it is followed too unless `followFinished` is false (list rows that only need the verdict:
 * each followed run holds one of the browser's few connections per host).
 */
export function useRun(runId: string, followFinished = true): LoadedRun {
  const [state, setState] = useState<LoadedRun>({ model: null, events: [], error: null });
  useEffect(() => {
    let alive = true;
    let stop: (() => void) | null = null;
    let frame = 0;
    let retry = 0;
    setState({ model: null, events: [], error: null });
    const load = (attempt: number): void => {
      api.events(runId).then(
        (events) => {
          if (!alive) return;
          const live = foldRun(runId, events);
          const all = [...events];
          setState({ model: { ...live }, events: all, error: null });
          if (live.status !== "running" && !followFinished) return;
          let last = events.at(-1)?.seq ?? -1;
          stop = tail(runId, last + 1, (event) => {
            if (event.seq <= last) return;
            last = event.seq;
            all.push(event);
            applyEvent(live, event);
            // Many events arrive in bursts; render at most once per frame.
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => alive && setState({ model: { ...live }, events: [...all], error: null }));
          });
        },
        (err: unknown) => {
          if (!alive) return;
          // A just-launched run has no log for a few seconds.
          if (attempt < 20) retry = window.setTimeout(() => load(attempt + 1), 1500);
          else setState({ model: null, events: [], error: err instanceof Error ? err.message : String(err) });
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
  }, [runId, followFinished]);
  return state;
}

/** Progressive replay of a finished log over about `seconds`; `shown` is null when not replaying. */
export function useReplay(total: number, seconds = 45): { shown: number | null; start: () => void; stop: () => void } {
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    if (shown === null) return;
    if (shown >= total) {
      const done = window.setTimeout(() => setShown(null), 800);
      return () => clearTimeout(done);
    }
    const step = Math.max(1, Math.ceil(total / (seconds * 10)));
    const timer = window.setTimeout(() => setShown((n) => (n === null ? null : Math.min(total, n + step))), 100);
    return () => clearTimeout(timer);
  }, [shown, total, seconds]);
  return { shown, start: () => setShown(1), stop: () => setShown(null) };
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
