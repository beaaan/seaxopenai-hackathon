import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { RunEvent, RunSummary } from "@shared/events";
import { fetchEvents, fetchRuns, subscribeEvents } from "./api";
import { AllocationPanel, EventFeed } from "./components/CenterPane";
import { BottomTabs } from "./components/BottomTabs";
import { FindingsPane } from "./components/FindingsPane";
import { PolicyPane } from "./components/PolicyPane";
import { foldEvents } from "./state";

type Mode = "replay" | "live";
type Speed = "instant" | "x1" | "x4";

const SPEED_MS: Record<Exclude<Speed, "instant">, number> = { x1: 400, x4: 100 };
const RUNS_REFRESH_MS = 5_000;

const STATUS_STYLE: Record<string, string> = {
  empty: "bg-slate-200 text-slate-700",
  running: "bg-sky-100 text-sky-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
};

function Toggle<T extends string>(props: { value: T; options: readonly T[]; labels: Record<T, string>; onChange: (v: T) => void }): ReactNode {
  return (
    <div className="flex overflow-hidden rounded ring-1 ring-slate-300">
      {props.options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => props.onChange(o)}
          className={`px-3 py-1 text-sm font-semibold ${o === props.value ? "bg-indigo-600 text-white" : "bg-white text-slate-700 hover:bg-slate-100"}`}
        >
          {props.labels[o]}
        </button>
      ))}
    </div>
  );
}

export function App(): ReactNode {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("replay");
  const [speed, setSpeed] = useState<Speed>("x1");
  const [playing, setPlaying] = useState(false);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [revealed, setRevealed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pickedVersion, setPickedVersion] = useState<number | null>(null);
  const [sentenceFilter, setSentenceFilter] = useState<string | null>(null);
  const [findingId, setFindingId] = useState<string | null>(null);

  const revealedRef = useRef(revealed);
  revealedRef.current = revealed;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  useEffect(() => {
    const load = (): void => {
      fetchRuns().then(setRuns, (err: unknown) => setError(String(err)));
    };
    load();
    const timer = setInterval(load, RUNS_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  // Replay: fetch the whole log, then reveal it progressively.
  useEffect(() => {
    if (runId === null || mode !== "replay") return;
    let cancelled = false;
    fetchEvents(runId).then(
      (all) => {
        if (cancelled) return;
        setEvents(all);
        if (speedRef.current === "instant") setRevealed(all.length);
        else {
          setRevealed((r) => Math.min(r, all.length));
          setPlaying(revealedRef.current < all.length);
        }
      },
      (err: unknown) => setError(String(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [runId, mode]);

  // Live: keep what was revealed, then tail the log over SSE from there.
  useEffect(() => {
    if (runId === null || mode !== "live") return;
    const from = revealedRef.current;
    setEvents((prev) => prev.slice(0, from));
    return subscribeEvents(
      runId,
      from,
      (event) => {
        setError(null);
        setEvents((prev) => (event.seq === prev.length ? [...prev, event] : prev));
      },
      setError,
    );
  }, [runId, mode]);

  useEffect(() => {
    if (mode !== "replay" || !playing || speed === "instant") return;
    const timer = setInterval(() => setRevealed((r) => r + 1), SPEED_MS[speed]);
    return () => clearInterval(timer);
  }, [mode, playing, speed]);

  useEffect(() => {
    if (mode === "replay" && playing && revealed >= events.length) {
      setPlaying(false);
      if (revealed > events.length) setRevealed(events.length);
    }
  }, [mode, playing, revealed, events.length]);

  const visible = useMemo(() => (mode === "live" ? events : events.slice(0, revealed)), [mode, events, revealed]);
  const view = useMemo(() => foldEvents(visible), [visible]);
  const version = pickedVersion !== null && view.versions[pickedVersion] !== undefined ? pickedVersion : view.currentVersion;

  const selectRun = (id: string): void => {
    setRunId(id === "" ? null : id);
    setEvents([]);
    setRevealed(0);
    revealedRef.current = 0;
    setPlaying(false);
    setPickedVersion(null);
    setSentenceFilter(null);
    setFindingId(null);
    setError(null);
  };

  const changeMode = (next: Mode): void => {
    if (next === mode) return;
    const position = mode === "live" ? events.length : revealed;
    setRevealed(position);
    revealedRef.current = position;
    setPlaying(false);
    setMode(next);
  };

  const changeSpeed = (next: Speed): void => {
    setSpeed(next);
    if (next === "instant") {
      setRevealed(events.length);
      setPlaying(false);
    }
  };

  const togglePlay = (): void => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (speed === "instant") {
      setRevealed(events.length);
      return;
    }
    if (revealed >= events.length) setRevealed(0);
    setPlaying(true);
  };

  return (
    <div className="flex h-screen flex-col gap-3 p-3">
      <header className="flex flex-wrap items-center gap-3 rounded-lg bg-white px-4 py-2 shadow-sm ring-1 ring-slate-200">
        <h1 className="text-xl font-bold">Policy Wind Tunnel</h1>
        <select
          value={runId ?? ""}
          onChange={(e) => selectRun(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          aria-label="run"
        >
          <option value="">— select run —</option>
          {runs.map((r) => (
            <option key={r.runId} value={r.runId}>
              {r.runId} · {r.policyId ?? "?"} · {r.status} · {r.events} ev
            </option>
          ))}
        </select>
        <Toggle value={mode} options={["replay", "live"] as const} labels={{ replay: "Replay", live: "Live" }} onChange={changeMode} />
        {mode === "replay" && (
          <>
            <Toggle value={speed} options={["instant", "x1", "x4"] as const} labels={{ instant: "Instant", x1: "×1", x4: "×4" }} onChange={changeSpeed} />
            <button
              type="button"
              onClick={togglePlay}
              disabled={runId === null}
              className="rounded bg-slate-800 px-3 py-1 text-sm font-semibold text-white disabled:opacity-40"
            >
              {playing ? "❚❚ Pause" : "▶ Play"}
            </button>
            <input
              type="range"
              min={0}
              max={events.length}
              value={Math.min(revealed, events.length)}
              onChange={(e) => {
                setPlaying(false);
                setRevealed(Number(e.target.value));
              }}
              className="w-48"
              aria-label="replay position"
            />
          </>
        )}
        <span className="font-mono text-sm" data-testid="progress">
          {visible.length}/{events.length}
        </span>
        <span className={`rounded px-2 py-0.5 text-sm font-semibold ${STATUS_STYLE[view.status] ?? ""}`}>{view.status}</span>
        {view.config !== null && (
          <span className="text-sm text-slate-500">
            {view.config.policyId} · budget {view.config.budget} · reader {view.config.models.reader}
          </span>
        )}
        {error !== null && <span className="text-sm text-red-700">{error}</span>}
      </header>

      <main className="grid min-h-0 flex-[3] grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3">
        <PolicyPane
          view={view}
          version={version}
          onVersion={(v) => {
            setPickedVersion(v);
            setSentenceFilter(null);
          }}
          sentenceId={sentenceFilter}
          onSentence={(id) => {
            setSentenceFilter(id);
            setFindingId(null);
          }}
        />
        <div className="flex min-h-0 flex-col gap-3">
          <EventFeed events={visible} />
          <AllocationPanel decisions={view.allocations} dimensions={view.dimensions} />
        </div>
        <FindingsPane
          view={view}
          version={version}
          sentenceFilter={sentenceFilter}
          selectedFindingId={findingId}
          onSelectFinding={setFindingId}
          onClearFilter={() => setSentenceFilter(null)}
        />
      </main>

      <div className="flex min-h-0 flex-[2] flex-col">
        <BottomTabs view={view} />
      </div>
    </div>
  );
}
