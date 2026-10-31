import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, ExternalLink, Monitor, Pause, Play, Radio, RotateCcw, Send, Wind } from "lucide-react";
import { NOTES, QAS, TALK_SECONDS } from "./content";
import type { QA, Topic } from "./content";
import { isPresenterMessage } from "./protocol";
import type { AudiencePosition, PresenterMessage } from "./protocol";

const TOPICS: Topic[] = ["Validity", "Method", "Results", "Cost", "Business", "Codex"];
const CHANNEL_NAME = "pwt-presenter";
const NOTE_CHAPTERS = NOTES.map((note) => note.chapter);

function formatTime(seconds: number): string {
  const rounded = Math.max(0, Math.floor(seconds));
  return `${Math.floor(rounded / 60).toString().padStart(2, "0")}:${(rounded % 60).toString().padStart(2, "0")}`;
}

function timeInSeconds(time: string): number {
  const [minutes = "0", seconds = "0"] = time.split(":");
  return Number(minutes) * 60 + Number(seconds);
}

function usePresenterChannel(judges: boolean) {
  const channel = useRef<BroadcastChannel | null>(null);
  const [position, setPosition] = useState<AudiencePosition | null>(null);
  const [connected, setConnected] = useState(false);
  const [questionId, setQuestionId] = useState(QAS[0]?.id ?? "");

  useEffect(() => {
    const connection = new BroadcastChannel(CHANNEL_NAME);
    channel.current = connection;
    let disconnectTimeout: number | undefined;
    connection.onmessage = (event: MessageEvent<unknown>) => {
      if (!isPresenterMessage(event.data)) return;
      const message = event.data;
      if (message.type === "at") {
        setPosition(message);
        setConnected(true);
        window.clearTimeout(disconnectTimeout);
        disconnectTimeout = window.setTimeout(() => setConnected(false), 6000);
      } else if (message.type === "qa" && QAS.some((question) => question.id === message.id)) {
        setQuestionId(message.id);
      }
    };
    const hello = () => connection.postMessage({ type: "hello" } satisfies PresenterMessage);
    if (!judges) hello();
    const heartbeat = judges ? undefined : window.setInterval(hello, 2000);
    return () => {
      window.clearInterval(heartbeat);
      window.clearTimeout(disconnectTimeout);
      channel.current = null;
      connection.close();
    };
  }, [judges]);

  const send = useCallback((message: PresenterMessage) => channel.current?.postMessage(message), []);
  return { position, connected, questionId, setQuestionId, send };
}

function useTalkTimer() {
  const [elapsed, setElapsed] = useState(0);
  const [running, setRunning] = useState(false);
  const startedAt = useRef<number | null>(null);
  const accumulated = useRef(0);

  const toggle = useCallback(() => {
    if (startedAt.current !== null) {
      accumulated.current += (performance.now() - startedAt.current) / 1000;
      startedAt.current = null;
      setElapsed(accumulated.current);
      setRunning(false);
    } else {
      startedAt.current = performance.now();
      setRunning(true);
    }
  }, []);

  const reset = useCallback(() => {
    startedAt.current = null;
    accumulated.current = 0;
    setElapsed(0);
    setRunning(false);
  }, []);

  useEffect(() => {
    if (!running) return;
    const interval = window.setInterval(() => {
      if (startedAt.current !== null) setElapsed(accumulated.current + (performance.now() - startedAt.current) / 1000);
    }, 100);
    return () => window.clearInterval(interval);
  }, [running]);

  return { elapsed, running, toggle, reset };
}

export function QuestionCard({ question, projector = false }: { question: QA; projector?: boolean }) {
  return (
    <article className={`question-card${projector ? " question-card--projector" : ""}`} aria-live="polite">
      <div className="question-kicker"><span className="small-rule" />{question.topic}<span className="kicker-divider">/</span>Q&A</div>
      <h1>{question.q}</h1>
      <p className="question-answer">{question.a}</p>
      {question.figures && question.figures.length > 0 && (
        <div className="question-figures">
          {question.figures.map((figure, index) => (
            <div className={`question-figure tone-${figure.tone ?? "cyan"}`} key={`${figure.label}-${index}`}>
              <strong>{figure.value}</strong>
              <span>{figure.label}</span>
            </div>
          ))}
        </div>
      )}
      {question.points.length > 0 && (
        <ul className="evidence-points">
          {question.points.map((point, index) => <li key={`${question.id}-${index}`}><span className="evidence-mark" />{point}</li>)}
        </ul>
      )}
      {question.link && (
        <a className="button evidence-link" href={question.link.href} target="pwt-evidence" rel="noopener noreferrer">
          {question.link.label}<ArrowUpRight size={18} aria-hidden="true" />
        </a>
      )}
    </article>
  );
}

function Brand({ judges = false }: { judges?: boolean }) {
  return <div className="brand"><Wind size={25} aria-hidden="true" /><span>Policy Wind Tunnel</span><span className="brand-divider" /><span className="brand-mode">{judges ? "Evidence desk" : "Presenter"}</span></div>;
}

function JudgesScreen({ questionId, onSelect }: { questionId: string; onSelect: (id: string) => void }) {
  const selected = QAS.find((question) => question.id === questionId) ?? QAS[0];
  const selectedIndex = selected ? QAS.indexOf(selected) : -1;
  const move = useCallback((direction: number) => {
    const next = QAS[selectedIndex + direction];
    if (next) onSelect(next.id);
  }, [onSelect, selectedIndex]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"))) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        move(event.key === "ArrowLeft" ? -1 : 1);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [move]);

  useEffect(() => {
    document.querySelector(".judges-question.is-selected")?.scrollIntoView({ block: "nearest" });
  }, [questionId]);

  return (
    <div className="judges-shell">
      <header className="judges-header"><Brand judges /><span className="judges-label"><span className="status-dot" />LIVE Q&A</span></header>
      <div className="judges-body">
        <aside className="judges-sidebar" aria-label="Questions by topic">
          <div className="sidebar-heading">Explore the evidence</div>
          <nav className="judges-question-list">
            {TOPICS.map((topic) => {
              const questions = QAS.filter((question) => question.topic === topic);
              return questions.length > 0 && <section className="question-group" key={topic}>
                <h2>{topic}</h2>
                {questions.map((question) => <button type="button" className={`judges-question${question.id === selected?.id ? " is-selected" : ""}`} aria-current={question.id === selected?.id ? "true" : undefined} onClick={() => onSelect(question.id)} key={question.id}>{question.q}</button>)}
              </section>;
            })}
          </nav>
          <div className="sidebar-footer"><span>{String(selectedIndex + 1).padStart(2, "0")} <span className="dim">/ {String(QAS.length).padStart(2, "0")}</span></span><div className="compact-navigation"><button type="button" aria-label="Previous question" onClick={() => move(-1)} disabled={selectedIndex <= 0}><ArrowLeft size={17} /></button><button type="button" aria-label="Next question" onClick={() => move(1)} disabled={selectedIndex >= QAS.length - 1}><ArrowRight size={17} /></button></div></div>
        </aside>
        <main className="judges-stage">{selected ? <QuestionCard question={selected} projector /> : <p>No questions available.</p>}</main>
      </div>
    </div>
  );
}

export function App() {
  const [hash, setHash] = useState(window.location.hash);
  const judges = hash.replace(/\/$/, "") === "#/judges";
  const [tab, setTab] = useState<"present" | "qa">("present");
  const [topic, setTopic] = useState<Topic | "All">("All");
  const [localIndex, setLocalIndex] = useState(0);
  const [shownId, setShownId] = useState<string | null>(null);
  const { position, connected, questionId, setQuestionId, send } = usePresenterChannel(judges);
  const timer = useTalkTimer();

  useEffect(() => {
    const updateHash = () => setHash(window.location.hash);
    window.addEventListener("hashchange", updateHash);
    return () => window.removeEventListener("hashchange", updateHash);
  }, []);

  useEffect(() => {
    document.title = judges ? "Policy Wind Tunnel · Q&A" : "Policy Wind Tunnel · Presenter";
  }, [judges]);

  const audienceChapter = position?.chapter ?? NOTES[localIndex]?.chapter;
  const matchingIndex = NOTES.findIndex((note) => note.chapter === audienceChapter);
  const currentIndex = matchingIndex >= 0 ? matchingIndex : localIndex;
  const current = NOTES[currentIndex];
  const next = NOTES[currentIndex + 1];
  const chapters = position?.chapters.length ? position.chapters : NOTE_CHAPTERS;
  const audienceIndex = audienceChapter ? chapters.indexOf(audienceChapter) : 0;
  const selected = QAS.find((question) => question.id === questionId) ?? QAS[0];
  const filtered = topic === "All" ? QAS : QAS.filter((question) => question.topic === topic);

  const goTo = useCallback((chapter: string) => {
    const noteIndex = NOTES.findIndex((note) => note.chapter === chapter);
    if (noteIndex >= 0) setLocalIndex(noteIndex);
    send({ type: "goto", chapter });
  }, [send]);

  const moveChapter = useCallback((direction: number) => {
    const chapter = chapters[audienceIndex + direction];
    if (chapter) goTo(chapter);
  }, [chapters, audienceIndex, goTo]);

  useEffect(() => {
    if (judges || tab !== "present") return;
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.matches("input, textarea, select"))) return;
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        moveChapter(event.key === "ArrowLeft" ? -1 : 1);
      } else if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        timer.toggle();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        timer.reset();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [judges, tab, moveChapter, timer.toggle, timer.reset]);

  if (judges) return <JudgesScreen questionId={questionId} onSelect={setQuestionId} />;

  const behind = next ? timer.elapsed > timeInSeconds(next.at) : false;
  const over = timer.elapsed > TALK_SECONDS;
  const timerTone = over ? "red" : behind ? "amber" : "cyan";
  const chooseTopic = (value: Topic | "All") => {
    setTopic(value);
    if (value !== "All" && selected?.topic !== value) {
      const first = QAS.find((question) => question.topic === value);
      if (first) setQuestionId(first.id);
    }
  };

  return (
    <div className="console-shell">
      <header className="console-header">
        <Brand />
        <div className="header-actions"><span className={`connection-badge${connected ? " is-connected" : ""}`}><span className="status-dot" />Audience {connected ? "connected" : "not connected"}</span><button type="button" className="button" onClick={() => window.open("/#/", "pwt-audience", "popup,width=1600,height=900")}><Monitor size={17} aria-hidden="true" />Open audience window<ExternalLink size={14} aria-hidden="true" /></button></div>
      </header>
      <div className="console-toolbar"><div className="console-tabs" role="tablist" aria-label="Presenter mode"><button type="button" role="tab" aria-selected={tab === "present"} id="present-tab" aria-controls="present-panel" onClick={() => setTab("present")}><Radio size={16} aria-hidden="true" />Present</button><button type="button" role="tab" aria-selected={tab === "qa"} id="qa-tab" aria-controls="qa-panel" onClick={() => setTab("qa")}><Send size={16} aria-hidden="true" />Q&A<span className="tab-count">{QAS.length}</span></button></div><span className="toolbar-caption">{tab === "present" ? "The story, at a glance." : "Select an answer. Put the evidence on screen."}</span></div>
      {tab === "present" ? (
        <main className="present-layout" role="tabpanel" id="present-panel" aria-labelledby="present-tab">
          <section className={`timer-panel tone-${timerTone}`} aria-label="Talk timer">
            <div className="timer-top"><span className="eyebrow">Talk clock</span><span className="timer-state">{over ? "Over budget" : behind ? "Next chapter due" : timer.running ? "On the clock" : timer.elapsed > 0 ? "Paused" : "Ready when you are"}</span></div>
            <div className="timer-main"><div className="timer-value" role="timer" aria-label={`${formatTime(timer.elapsed)} elapsed`}>{formatTime(timer.elapsed)}<span>/ {formatTime(TALK_SECONDS)}</span></div><div className="timer-buttons"><button type="button" className="button button-primary" onClick={timer.toggle}>{timer.running ? <Pause size={17} /> : <Play size={17} />}{timer.running ? "Pause" : "Start"}<kbd>S</kbd></button><button type="button" className="button" onClick={timer.reset}><RotateCcw size={16} />Reset<kbd>R</kbd></button></div></div>
            <div className="timer-track" role="progressbar" aria-label="Talk budget used" aria-valuemin={0} aria-valuemax={TALK_SECONDS} aria-valuenow={Math.min(TALK_SECONDS, Math.floor(timer.elapsed))}><span style={{ width: `${Math.min(100, timer.elapsed / TALK_SECONDS * 100)}%` }} /></div>
            <div className="timer-bottom"><span>{next ? <>Next chapter at <strong>{next.at}</strong></> : "Final chapter"}</span><span>{over ? `${formatTime(timer.elapsed - TALK_SECONDS)} over` : `${formatTime(TALK_SECONDS - timer.elapsed)} remaining`}</span></div>
          </section>
          <div className="notes-grid">
            <section className="current-note panel" aria-label="Current chapter">
              <div className="note-heading"><span className="eyebrow"><span className="status-dot" />On screen now</span><span className="note-counter">{String(currentIndex + 1).padStart(2, "0")} / {String(NOTES.length).padStart(2, "0")}</span></div>
              <h1>{current?.chapter ?? "Select a chapter"}</h1>
              <p className="say">{current?.say}</p>
              {current && current.points.length > 0 && <ul className="note-points">{current.points.map((point, index) => <li key={index}><span />{point}</li>)}</ul>}
              {current?.act && <div className="action-badge"><ArrowUpRight size={19} aria-hidden="true" /><div><span>On-screen action</span><strong>{current.act}</strong></div></div>}
            </section>
            <aside className="next-note panel" aria-label="Next chapter"><div className="note-heading"><span className="eyebrow">Up next</span>{next && <span className="next-at">{next.at}</span>}</div>{next ? <><h2>{next.chapter}</h2><p>{next.say}</p></> : <><h2>Land the close.</h2><p>This is the final chapter. Open Q&A when you are ready for questions.</p></>}<div className="chapter-navigation"><button type="button" className="button" disabled={audienceIndex <= 0} onClick={() => moveChapter(-1)}><ArrowLeft size={17} />Prev</button><button type="button" className="button button-primary" disabled={audienceIndex >= chapters.length - 1} onClick={() => moveChapter(1)}>Next<ArrowRight size={17} /></button></div><div className="keyboard-hint"><kbd>←</kbd><kbd>→</kbd> to move the audience</div></aside>
          </div>
          <nav className="chapter-strip" aria-label="Jump to chapter">{NOTES.map((note, index) => <button type="button" key={note.chapter} className={index === currentIndex ? "is-current" : ""} aria-current={index === currentIndex ? "step" : undefined} onClick={() => goTo(note.chapter)}><span className="chapter-number">{String(index + 1).padStart(2, "0")}</span><span className="chapter-name">{note.chapter}</span><span className="chapter-at">{note.at}</span></button>)}</nav>
        </main>
      ) : (
        <main className="qa-console" role="tabpanel" id="qa-panel" aria-labelledby="qa-tab">
          <section className="qa-browser panel" aria-label="Question library"><div className="library-heading"><span className="eyebrow">Question library</span><span className="muted">{filtered.length} questions</span></div><div className="topic-filters" aria-label="Filter questions by topic">{(["All", ...TOPICS] as const).map((value) => <button type="button" aria-pressed={topic === value} className={topic === value ? "is-active" : ""} onClick={() => chooseTopic(value)} key={value}>{value}</button>)}</div><div className="qa-question-list">{filtered.map((question) => <button type="button" className={`qa-question${question.id === selected?.id ? " is-selected" : ""}`} aria-pressed={question.id === selected?.id} onClick={() => { setQuestionId(question.id); setShownId(null); }} key={question.id}><span>{question.topic}</span><strong>{question.q}</strong><ArrowUpRight size={16} aria-hidden="true" /></button>)}</div></section>
          <section className="qa-preview" aria-label="Judges screen preview"><div className="preview-toolbar"><span className="eyebrow">Judges screen preview</span><button type="button" className="button" onClick={() => window.open("/presenter/#/judges", "pwt-judges")}><ExternalLink size={16} />Open judges screen</button></div><div className="preview-card panel">{selected && <QuestionCard question={selected} />}</div><div className="qa-send-bar"><span className="muted">{shownId === selected?.id ? "Sent to the judges screen" : "Your selection stays private until you send it."}</span><button type="button" className="button button-primary" disabled={!selected} onClick={() => { if (selected) { send({ type: "qa", id: selected.id }); setShownId(selected.id); } }}>{shownId === selected?.id ? <Check size={17} /> : <Send size={17} />}Show on judges screen</button></div></section>
        </main>
      )}
    </div>
  );
}
