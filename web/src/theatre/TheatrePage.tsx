import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FastForward, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import type { RunEvent } from "@shared/events";
import type { FolkVersion } from "@shared/schema";
import { api, type PolicyDetail } from "../api";
import { useRun } from "../hooks";
import { applyEvent, CLASS_LABEL, emptyRun, foldRun, misreadings, originalReadings } from "../model";
import { ReaderFlow } from "../landing/ReaderFlow";
import { tunnelData } from "../landing/tunnel";
import { AgentPanel } from "./AgentPanel";
import { emptyAgents, onAllocation, onThreadItem, type Agents } from "./agents";
import { STAGES, endOf, isRetestReading, schedule, stageOf, type StageId } from "./timeline";
import "./theatre.css";

interface Hud {
  stage: StageId | null;
  reached: Set<StageId>;
  readings: number;
  rereads: number;
  interpretations: number;
  graded: number;
  clusters: number;
  toolCalls: number;
  agents: Agents;
}

/** Playback owns these mutable objects; every seek starts with a fresh set. */
function emptyHud(): Hud {
  return { stage: null, reached: new Set(), readings: 0, rereads: 0, interpretations: 0, graded: 0, clusters: 0, toolCalls: 0, agents: emptyAgents() };
}
const SPEEDS = [1, 2, 4] as const;
const NO_FOLK: readonly FolkVersion[] = [];

/** The same event log drives the replay counters, agents, and reader flow at the playhead. */
export function TheatrePage(props: { runId: string }): ReactNode {
  const { runId } = props;
  const loaded = useRun(runId);
  const events = loaded.events;
  const [policy, setPolicy] = useState<PolicyDetail | null>(null);
  const policyId = loaded.model?.config?.policyId ?? null;
  useEffect(() => {
    if (!policyId) return;
    let alive = true;
    api.policy(policyId).then((p) => alive && setPolicy(p), () => {});
    return () => { alive = false; };
  }, [policyId]);

  const [hud, setHud] = useState<Hud>(emptyHud);
  const hudRef = useRef<Hud>(emptyHud());
  const modelRef = useRef(emptyRun(runId));
  const [replay, setReplay] = useState(() => emptyRun(runId));
  const times = useRef<number[]>([]);
  const cursor = useRef(0);
  const clock = useRef(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [progress, setProgress] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const eventsRef = useRef<readonly RunEvent[]>(events);
  eventsRef.current = events;
  times.current = useMemo(() => schedule(events, times.current), [events]);

  const applyHud = useCallback((e: RunEvent, index: number): void => {
    const h = hudRef.current;
    const stage = stageOf(e);
    if (stage) {
      h.stage = stage;
      h.reached.add(stage);
    }
    switch (e.type) {
      case "reading.completed":
        if (isRetestReading(e)) h.rereads++;
        else {
          h.readings++;
          h.interpretations += e.payload.reading.interpretations.length;
        }
        break;
      case "grades.added":
        h.graded += e.payload.grades.length;
        break;
      case "clusters.updated":
        h.clusters = e.payload.clusters.length;
        break;
      case "thread.item":
        onThreadItem(h.agents, e.payload.record, index);
        if (e.payload.record.itemType === "dynamicToolCall") h.toolCalls++;
        break;
      case "allocation.decided":
        onAllocation(h.agents, e.payload.decision, index);
        break;
      default:
        break;
    }
  }, []);

  const flush = useCallback((): void => {
    const h = hudRef.current;
    setHud({ ...h, reached: new Set(h.reached) });
    setReplay({ ...modelRef.current });
  }, []);

  /** Fold exactly the event prefix at this time, discarding all later agent and reading state. */
  const seek = useCallback((target: number): void => {
    hudRef.current = emptyHud();
    cursor.current = 0;
    const list = eventsRef.current;
    while (cursor.current < list.length && times.current[cursor.current]! <= target) {
      applyHud(list[cursor.current]!, cursor.current);
      cursor.current++;
    }
    modelRef.current = foldRun(runId, list.slice(0, cursor.current));
    clock.current = target;
    const end = endOf(list, times.current);
    setProgress(end > 0 ? target / end : 0);
    flush();
  }, [applyHud, flush, runId]);

  const playingRef = useRef(playing);
  playingRef.current = playing;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let sinceFlush = 0;
    let dirty = false;
    const tick = (now: number): void => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      frame = requestAnimationFrame(tick);
      const list = eventsRef.current;
      const end = endOf(list, times.current);
      if (playingRef.current && list.length > 0) {
        clock.current = Math.min(end, clock.current + dt * speedRef.current);
        while (cursor.current < list.length && times.current[cursor.current]! <= clock.current) {
          const event = list[cursor.current]!;
          applyEvent(modelRef.current, event);
          applyHud(event, cursor.current);
          cursor.current++;
          dirty = true;
        }
        sinceFlush += dt;
        if (dirty && (sinceFlush > 0.08 || cursor.current >= list.length)) {
          sinceFlush = 0;
          dirty = false;
          flush();
        }
      }
      setProgress(end > 0 ? clock.current / end : 0);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [applyHud, flush]);

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLElement && (e.target.closest("input, button, textarea, select") || e.target.isContentEditable)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const folk = policy?.folk.versions ?? NO_FOLK;
  const data = useMemo(() => tunnelData(replay, folk), [replay, folk]);
  const rows = useMemo(() => misreadings(replay), [replay]);
  const read = useMemo(() => originalReadings(replay).length, [replay]);
  const defaultActive = data?.pools.reduce((best, pool, i, pools) => pool.readers > pools[best]!.readers ? i : best, 0) ?? -1;
  const picked = data?.pools.findIndex((p) => p.id === activeId) ?? -1;
  const active = picked >= 0 ? picked : defaultActive;
  const selected = data?.pools[active];
  const finding = rows.find((r) => r.id === selected?.id);
  const total = endOf(events, times.current);
  const live = loaded.model?.status === "running";
  const caughtUp = cursor.current >= events.length;
  const done = replay.status === "completed";
  const title = policy?.package.title ?? policyId ?? runId;
  const stageName = done ? "Run complete" : STAGES.find((s) => s.id === hud.stage)?.label ?? "Preparing the policy";
  const stageTimes = useMemo(() => {
    const starts = new Map<StageId, number>();
    events.forEach((e, i) => {
      const stage = stageOf(e);
      if (stage && !starts.has(stage)) starts.set(stage, times.current[i]!);
    });
    return starts;
  }, [events]);

  return (
    <div className="theatre">
      <header className="t-top">
        <a className="t-brand" href="#/">Policy Wind Tunnel</a>
        <div className="t-title">
          <b>{title}</b>
          <span>{live && caughtUp ? <i className="t-live">Live</i> : <i className="t-replay">Replay · {speed}×</i>} <code>{runId}</code></span>
        </div>
        <a className="t-report" href={`#/run/${encodeURIComponent(runId)}`}>Open the report →</a>
      </header>

      <nav className="t-stages" aria-label="Pipeline stages">
        <ol className="t-rail">
          {STAGES.map((s) => (
            <li key={s.id} className={s.id === hud.stage ? "now" : hud.reached.has(s.id) ? "done" : undefined}>
              <button type="button" aria-current={s.id === hud.stage ? "step" : undefined} disabled={!stageTimes.has(s.id)} onClick={() => seek(stageTimes.get(s.id)!)}>{s.label}</button>
            </li>
          ))}
        </ol>
      </nav>

      <div className="t-body">
        <main className="t-main">
          <div className="t-stage-heading">
            <div><span className="t-kicker">The run, one event at a time</span><h1>{stageName}</h1></div>
            <p className="t-readers"><strong>{read}<small> / {replay.scenarios.length}</small></strong><span>readers read</span></p>
          </div>
          <dl className="t-counters">
            <div><dt>Readings</dt><dd>{hud.readings + hud.rereads}</dd></div>
            <div><dt>Interpretations</dt><dd>{hud.interpretations}</dd></div>
            <div><dt>Judged</dt><dd>{hud.graded}</dd></div>
            <div><dt>Belief clusters</dt><dd>{hud.clusters}</dd></div>
            <div><dt>Agent tool calls</dt><dd>{hud.toolCalls}</dd></div>
          </dl>
          <div className="t-stage" aria-label="Reader flow at the current replay time">
            {data ? <ReaderFlow data={data} active={active} onActive={(i) => setActiveId(data.pools[i]?.id ?? null)} /> : (
              <div className="t-empty"><span className="t-kicker">Waiting for the first readers</span><p>{loaded.error ?? "The flow begins when the run creates its reader scenarios."}</p></div>
            )}
          </div>
          <p className="t-flow-caption">Each band follows real readers in this run. Select a destination to trace it back.</p>
        </main>

        <aside className="t-sidebar" aria-label="Agents and current result">
          <AgentPanel agents={hud.agents} />
          {!hud.agents.active && <section className="t-agent t-agent-wait"><h2>Agent activity</h2><p>Tool calls and decisions appear here as the run reaches them.</p></section>}
          {selected && <section className={`t-result role-${selected.role}`} aria-label="Selected reader destination">
            <span className="t-kicker">{replay.findings.length > 0 ? `${replay.findings.length} misreadings found` : "What readers believe so far"}</span>
            <p className="t-result-count"><b>{selected.readers}</b><span>of {data?.total} readers</span></p>
            <h2>{selected.label}</h2>
            {finding?.kind && <span className="t-kind">{CLASS_LABEL[finding.kind]}</span>}
            {selected.role === "pending" && <p>These readers have not completed their original reading yet.</p>}
            {selected.role === "ungrouped" && <p>These readings have not been grouped into shared beliefs yet.</p>}
          </section>}
        </aside>
      </div>

      <footer className="t-controls">
        <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause /> : <Play />}</button>
        <button type="button" onClick={() => { seek(0); setPlaying(true); }} aria-label="Restart"><RotateCcw /></button>
        <button type="button" onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]!)} aria-label="Change speed"><FastForward /> {speed}×</button>
        <input type="range" min={0} max={1000} value={Math.round(progress * 1000)} aria-label="Position in the run" onChange={(e) => seek((Number(e.currentTarget.value) / 1000) * total)} />
        <output className="t-time">{timestamp(progress * total)}<span> / {timestamp(total)}</span></output>
        <button type="button" onClick={() => seek(total)} aria-label="Skip to the end"><SkipForward /></button>
        <a href={`#/run/${encodeURIComponent(runId)}`}>Report</a>
      </footer>
    </div>
  );
}

function timestamp(seconds: number): string {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

