import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FastForward, Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import type { RunEvent } from "@shared/events";
import type { Cluster, Finding, FolkVersion, Score } from "@shared/schema";
import { api, type PolicyDetail } from "../api";
import { useRun } from "../hooks";
import { CLASS_LABEL, cohortSize, foldRun, misreadings, type Misreading } from "../model";
import { TheatreScene } from "./scene";
import { STAGES, endOf, isRetestReading, schedule, stageOf, type StageId } from "./timeline";
import "./theatre.css";

interface Line {
  key: number;
  who: string;
  text: string;
  kind: "tool" | "say" | "think" | "task" | "decide" | "system";
}

interface Hud {
  stage: StageId | null;
  reached: Set<StageId>;
  readers: number;
  readings: number;
  rereads: number;
  interpretations: number;
  graded: number;
  clusters: number;
  toolCalls: number;
  baselines: number;
  agent: Line[];
  log: Array<{ key: number; at: string; type: string; detail: string }>;
  findings: Misreading[] | null;
  total: number;
  score: Score | null;
  done: boolean;
}

const EMPTY: Hud = { stage: null, reached: new Set(), readers: 0, readings: 0, rereads: 0, interpretations: 0, graded: 0, clusters: 0, toolCalls: 0, baselines: 0, agent: [], log: [], findings: null, total: 0, score: null, done: false };
const SPEEDS = [1, 2, 4] as const;

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
    return () => {
      alive = false;
    };
  }, [policyId]);

  const canvas = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<TheatreScene | null>(null);
  const [hud, setHud] = useState<Hud>(EMPTY);
  const hudRef = useRef<Hud>(EMPTY);
  const times = useRef<number[]>([]);
  const cursor = useRef(0);
  const clock = useRef(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [progress, setProgress] = useState(0);
  const folk = useMemo(() => new Map<string, FolkVersion>((policy?.folk.versions ?? []).map((f) => [f.id, f])), [policy]);
  const eventsRef = useRef<readonly RunEvent[]>(events);
  eventsRef.current = events;
  const folkRef = useRef(folk);
  folkRef.current = folk;

  times.current = useMemo(() => schedule(events, times.current), [events]);

  // The scene lives as long as the page.
  useEffect(() => {
    if (!canvas.current || !overlay.current || !host.current) return;
    let s: TheatreScene;
    try {
      s = new TheatreScene(canvas.current, overlay.current);
    } catch {
      return;
    }
    scene.current = s;
    const fit = (): void => {
      const r = host.current!.getBoundingClientRect();
      s.resize(Math.round(r.width), Math.round(r.height));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host.current);
    return () => {
      ro.disconnect();
      s.dispose();
      scene.current = null;
    };
  }, []);

  const apply = useCallback((e: RunEvent, index: number, instant: boolean): void => {
    const s = scene.current;
    const h = hudRef.current;
    const stage = stageOf(e);
    if (stage) {
      h.stage = stage;
      h.reached.add(stage);
    }
    const agent = (line: Omit<Line, "key">): void => {
      // One "thinking" line at a time; a run of them says nothing new.
      if (line.kind === "think" && h.agent.at(-1)?.kind === "think") return;
      h.agent = [...h.agent.slice(-4), { ...line, key: index }];
    };
    let detail = "";
    switch (e.type) {
      case "run.started":
        s?.setReaderTotal(e.payload.config.budget);
        detail = `budget ${e.payload.config.budget} readers · reader ${e.payload.config.models.reader} · grader ${e.payload.config.models.grader}`;
        break;
      case "policy.version":
        if (e.payload.policy.version === 0) s?.policy(e.payload.policy.sentences);
        detail = `v${e.payload.policy.version} · ${e.payload.policy.sentences.length} sentences`;
        break;
      case "dims.extracted":
        detail = `${e.payload.dimensions.length} ways readers differ`;
        agent({ who: "Pipeline", kind: "system", text: `Readers will differ by: ${e.payload.dimensions.map((d) => d.id.replace(/_/g, " ")).join(", ")}.` });
        break;
      case "scenario.created": {
        const sc = e.payload.scenario;
        const heard = sc.exposure.folkVersionId ? folkRef.current.get(sc.exposure.folkVersionId)?.claimEn ?? sc.exposure.folkVersionId : null;
        s?.reader(sc, instant, heard);
        h.readers++;
        detail = `${sc.id} ${sc.persona.name}, ${sc.persona.age}, ${sc.persona.province}`;
        break;
      }
      case "reading.completed": {
        const r = e.payload.reading;
        const retest = isRetestReading(e);
        s?.read(r, retest, instant);
        if (retest) h.rereads++;
        else {
          h.readings++;
          h.interpretations += r.interpretations.length;
        }
        detail = `${r.scenarioId} ${retest ? "read again (variation)" : `${r.interpretations.length} interpretations`} · ${r.model}`;
        break;
      }
      case "grades.added":
        s?.grade(e.payload.grades, instant);
        h.graded += e.payload.grades.length;
        detail = `${e.payload.grades.length} interpretations judged against the reference`;
        break;
      case "clusters.updated": {
        const all = eventsRef.current.slice(0, index + 1);
        const scenarioOf = new Map<string, string>();
        for (const x of all) if (x.type === "reading.completed") scenarioOf.set(x.payload.reading.id, x.payload.reading.scenarioId);
        const readerCount = (c: Cluster): number => new Set(c.readingIds.map((id) => scenarioOf.get(id) ?? id)).size;
        s?.clusters(e.payload.clusters, readerCount, instant);
        h.clusters = e.payload.clusters.length;
        detail = `${e.payload.clusters.length} belief clusters`;
        break;
      }
      case "thread.item": {
        const r = e.payload.record;
        const line = describeItem(r.itemType, r.item);
        if (line && r.role !== "probe") agent({ who: r.label, ...line });
        if (r.itemType === "dynamicToolCall") h.toolCalls++;
        detail = `${r.label} · ${r.itemType}`;
        break;
      }
      case "allocation.decided": {
        const d = e.payload.decision;
        s?.agentPulse();
        agent({ who: "Reviewer", kind: "decide", text: d.stopExploring ? `Stop exploring. ${d.rationale}` : `Next ${d.n} readers, focused on ${d.focusDimIds.map((x) => x.replace(/_/g, " ")).join(" and ")}. ${d.rationale}` });
        detail = `batch ${d.batch}: ${d.stopExploring ? "stop" : `+${d.n} readers`}`;
        break;
      }
      case "findings.updated": {
        const m = foldRun(runId, eventsRef.current.slice(0, index + 1));
        h.findings = misreadings(m);
        h.total = cohortSize(m);
        s?.findingsLanded();
        detail = `${e.payload.findings.length} misreadings named`;
        break;
      }
      case "baseline.completed":
        h.baselines++;
        detail = `single AI review by ${e.payload.run.model}: ${e.payload.run.issues.length} issues`;
        break;
      case "score.completed":
        h.score = e.payload.score;
        detail = "scored blind against the holdout";
        break;
      case "run.completed":
        h.done = true;
        detail = e.payload.summary;
        break;
      case "log":
        detail = e.payload.message;
        break;
      default:
        break;
    }
    const t0 = eventsRef.current[0]?.ts ? Date.parse(eventsRef.current[0].ts) : Date.parse(e.ts);
    const sec = Math.max(0, Math.round((Date.parse(e.ts) - t0) / 1000));
    h.log = [...h.log.slice(-6), { key: index, at: `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`, type: e.type, detail }];
  }, [runId]);

  const flush = useCallback((): void => {
    const h = hudRef.current;
    setHud({ ...h, reached: new Set(h.reached) });
  }, []);

  const seek = useCallback((target: number): void => {
    const s = scene.current;
    if (target < clock.current) {
      s?.reset();
      hudRef.current = { ...EMPTY, reached: new Set() };
      cursor.current = 0;
    }
    const list = eventsRef.current;
    while (cursor.current < list.length && times.current[cursor.current]! <= target) {
      apply(list[cursor.current]!, cursor.current, true);
      cursor.current++;
    }
    clock.current = target;
    flush();
  }, [apply, flush]);

  // Playback loop.
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  useEffect(() => {
    let frame = 0;
    let last = performance.now();
    let sinceFlush = 0;
    const tick = (now: number): void => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const list = eventsRef.current;
      const end = endOf(list, times.current);
      if (playingRef.current && list.length > 0) {
        clock.current = Math.min(end, clock.current + dt * speedRef.current);
        let changed = false;
        while (cursor.current < list.length && times.current[cursor.current]! <= clock.current) {
          apply(list[cursor.current]!, cursor.current, false);
          cursor.current++;
          changed = true;
        }
        sinceFlush += dt;
        if (changed && sinceFlush > 0.08) {
          sinceFlush = 0;
          flush();
        }
      }
      scene.current?.frame(dt);
      setProgress(end > 0 ? clock.current / end : 0);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [apply, flush]);

  // Space toggles play; arrows change speed.
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPlaying((p) => !p);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  const total = endOf(events, times.current);
  const live = loaded.model?.status === "running";
  const caughtUp = cursor.current >= events.length;
  const title = policy?.package.title ?? policyId ?? runId;
  const stageIndex = hud.stage ? STAGES.findIndex((s) => s.id === hud.stage) : -1;

  return (
    <div className="theatre">
      <div className="t-stage" ref={host}>
        <canvas ref={canvas} className="t-canvas" aria-label="Animated view of the run: readers, the policy text and the beliefs they formed" />
        <div className="t-overlay" ref={overlay} aria-hidden="true" />
        <div className="t-zone readers">{hud.readers || "…"} readers<small><i className="c-amber">told a rumour</i> <i className="c-cyan">heard nothing</i></small></div>
        <div className="t-zone text">Policy text</div>
        <div className="t-zone beliefs">Beliefs<small><i className="c-green">fits the policy</i> <i className="c-amber">not in the text</i> <i className="c-red">contradicts it</i></small></div>
      </div>

      <header className="t-top">
        <a className="t-brand" href="#/">Policy Wind Tunnel</a>
        <div className="t-title">
          <b>{title}</b>
          <span>{live && caughtUp ? <i className="t-live">Live</i> : <i className="t-replay">Replay · {speed}×</i>} <code>{runId}</code></span>
        </div>
        <ol className="t-rail" aria-label="Pipeline stages">
          {STAGES.map((s, i) => (
            <li key={s.id} className={s.id === hud.stage ? "now" : hud.reached.has(s.id) || i < stageIndex ? "done" : undefined}>{s.label}</li>
          ))}
        </ol>
      </header>

      <dl className="t-counters">
        <div><dt>Readers</dt><dd>{hud.readers}</dd></div>
        <div><dt>Readings</dt><dd>{hud.readings + hud.rereads}</dd></div>
        <div><dt>Interpretations</dt><dd>{hud.interpretations}</dd></div>
        <div><dt>Judged</dt><dd>{hud.graded}</dd></div>
        <div><dt>Belief clusters</dt><dd>{hud.clusters}</dd></div>
        <div><dt>Agent tool calls</dt><dd>{hud.toolCalls}</dd></div>
      </dl>

      <section className="t-agent" aria-label="Agent">
        <h2>Agent <span>Codex</span></h2>
        <ol>
          {hud.agent.map((l) => (
            <li key={l.key} className={l.kind}><b>{l.who}</b> {l.text}</li>
          ))}
        </ol>
      </section>

      <section className={hud.findings ? "t-log behind" : "t-log"} aria-label="Event log">
        <h2>Log</h2>
        <ol>
          {hud.log.map((l) => (
            <li key={l.key}><time>{l.at}</time><b>{l.type}</b><span>{l.detail}</span></li>
          ))}
        </ol>
      </section>

      {hud.findings && (
        <section className="t-findings" aria-label="Misreadings found">
          <h2>{hud.findings.length} misreadings</h2>
          <ol>
            {hud.findings.slice(0, 6).map((f, i) => (
              <li key={f.id} style={{ animationDelay: `${i * 140}ms` }}>
                <b>{f.readers.length}<small>/{hud.total}</small></b>
                <span>{f.title}{f.kind && <em className={`k-${f.kind}`}>{CLASS_LABEL[f.kind as Finding["class"]]}</em>}</span>
              </li>
            ))}
          </ol>
          {hud.score && <ScoreLine score={hud.score} />}
          {hud.done && <a className="t-open" href={`#/run/${encodeURIComponent(runId)}`}>Open the report</a>}
        </section>
      )}

      <footer className="t-controls">
        <button type="button" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause /> : <Play />}</button>
        <button type="button" onClick={() => { seek(0); setPlaying(true); }} aria-label="Restart"><RotateCcw /></button>
        <button type="button" onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length]!)} aria-label="Change speed"><FastForward /> {speed}×</button>
        <input
          type="range"
          min={0}
          max={1000}
          value={Math.round(progress * 1000)}
          aria-label="Position in the run"
          onChange={(e) => seek((Number(e.currentTarget.value) / 1000) * total)}
        />
        <button type="button" onClick={() => seek(total)} aria-label="Skip to the end"><SkipForward /></button>
        <a href={`#/run/${encodeURIComponent(runId)}`}>Report</a>
      </footer>
    </div>
  );
}

function ScoreLine(props: { score: Score }): ReactNode {
  const tunnel = props.score.systems.find((s) => s.id === "wind-tunnel");
  const review = props.score.systems.find((s) => s.id === "baseline-mean");
  if (!tunnel || !review) return null;
  return (
    <p className="t-score">
      Known edge cases found, scored blind: single AI review <b>{Math.round(review.recall * 100)}%</b>, wind tunnel <b>{Math.round(tunnel.recall * 100)}%</b>
    </p>
  );
}

/** One readable line for a Codex thread item; null for items with nothing to show. */
function describeItem(itemType: string, item: unknown): Omit<Line, "key" | "who"> | null {
  const o = (item ?? {}) as Record<string, unknown>;
  if (itemType === "dynamicToolCall") {
    const args = o.arguments && typeof o.arguments === "object" ? Object.entries(o.arguments as Record<string, unknown>).filter(([, v]) => v !== null).map(([k, v]) => `${k}=${String(v)}`).join(", ") : "";
    return { kind: "tool", text: `${String(o.tool ?? "tool")}(${args})` };
  }
  if (itemType === "agentMessage" && typeof o.text === "string") {
    try {
      const parsed = JSON.parse(o.text) as Record<string, unknown>;
      if (typeof parsed.rationale === "string") return { kind: "say", text: parsed.rationale };
    } catch {
      // Plain text message.
    }
    return { kind: "say", text: o.text.slice(0, 280) };
  }
  if (itemType === "reasoning") return { kind: "think", text: "thinking…" };
  if (itemType === "userMessage" && Array.isArray(o.content)) {
    const first = o.content[0] as { text?: unknown } | undefined;
    if (typeof first?.text === "string") {
      try {
        const task = (JSON.parse(first.text) as { task?: unknown }).task;
        if (typeof task === "string") return { kind: "task", text: task };
      } catch {
        return { kind: "task", text: first.text.slice(0, 160) };
      }
    }
  }
  return null;
}
