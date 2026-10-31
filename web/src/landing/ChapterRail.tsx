import { useEffect, useRef, useState, type ReactNode } from "react";

interface Chapter {
  el: HTMLElement;
  label: string;
}

/** How far down the viewport a chapter's top must pass before it counts as the one being read. */
const READING_LINE = 0.25;
/** Wheel silence that separates one gesture from the next. */
const GESTURE_GAP = 200;

/** Channel shared with the presenter site (web/presenter, same origin). */
const PRESENTER_CHANNEL = "pwt-presenter";
type PresenterMessage =
  | { type: "at"; chapter: string; index: number; chapters: string[] }
  | { type: "goto"; chapter: string }
  | { type: "hello" };

function isPresenterMessage(m: unknown): m is PresenterMessage {
  if (typeof m !== "object" || m === null || !("type" in m)) return false;
  if (m.type === "hello") return true;
  if (m.type === "goto") return "chapter" in m && typeof m.chapter === "string";
  return false;
}

/**
 * Story progress at the right edge: one dot per `[data-chapter]` section; click to jump. The lit dot is the last
 * chapter whose top has passed the reading line, so short chapters light up too.
 */
export function ChapterRail(): ReactNode {
  const ref = useRef<HTMLElement>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [active, setActive] = useState<HTMLElement | null>(null);

  // Chapters that need the run model mount later, so re-read the list whenever the root's children change.
  useEffect(() => {
    const root = ref.current?.parentElement;
    if (!root) return;
    const scan = (): void => {
      const found = [...root.querySelectorAll<HTMLElement>(":scope > section[data-chapter]")];
      setChapters(found.map((el) => ({ el, label: el.dataset.chapter ?? "" })));
    };
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(root, { childList: true });
    return () => mo.disconnect();
  }, []);

  // A presenter window on the same origin can follow the talk and drive it: the page reports the chapter in view and
  // scrolls to a chapter on request. Only a visible page takes part, so a landing tab left open in the background never
  // answers for the audience window.
  const latest = useRef<{ chapters: Chapter[]; active: HTMLElement | null }>({ chapters: [], active: null });
  const channel = useRef<BroadcastChannel | null>(null);
  const report = (): void => {
    if (document.visibilityState !== "visible") return;
    const { chapters: list, active: current } = latest.current;
    const index = list.findIndex((c) => c.el === current);
    if (index < 0) return;
    const message: PresenterMessage = { type: "at", chapter: list[index]!.label, index, chapters: list.map((c) => c.label) };
    channel.current?.postMessage(message);
  };
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(PRESENTER_CHANNEL);
    channel.current = ch;
    ch.onmessage = (e: MessageEvent<unknown>) => {
      const m = e.data;
      if (!isPresenterMessage(m) || document.visibilityState !== "visible") return;
      if (m.type === "hello") report();
      else if (m.type === "goto") latest.current.chapters.find((c) => c.label === m.chapter)?.el.scrollIntoView({ behavior: "smooth" });
    };
    document.addEventListener("visibilitychange", report);
    return () => {
      document.removeEventListener("visibilitychange", report);
      ch.close();
      channel.current = null;
    };
  }, []);
  useEffect(() => {
    latest.current = { chapters, active };
    report();
  }, [chapters, active]);

  useEffect(() => {
    let frame = 0;
    const update = (): void => {
      frame = 0;
      const line = window.innerHeight * READING_LINE;
      let current = chapters[0]?.el ?? null;
      for (const c of chapters) if (c.el.getBoundingClientRect().top <= line) current = c.el;
      setActive(current);
    };
    const schedule = (): void => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [chapters]);

  // One wheel gesture or Page Down/Up/Space moves one chapter. A chapter taller than the screen scrolls natively until
  // its edge is in view, then the next gesture jumps. After a jump, wheel events are swallowed until a pause of
  // GESTURE_GAP ms marks a new gesture, so trackpad momentum never carries one swipe across two chapters.
  useEffect(() => {
    if (chapters.length === 0) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let busyUntil = 0;
    let lastWheel = 0;
    let armed = true;
    const jump = (dir: 1 | -1): boolean => {
      const els = chapters.map((c) => c.el);
      let i = 0;
      els.forEach((el, k) => {
        if (el.getBoundingClientRect().top <= 2) i = k;
      });
      const box = els[i]!.getBoundingClientRect();
      // Still inside a tall chapter: leave the scroll to the browser.
      if (dir > 0 && box.bottom > window.innerHeight + 2) return false;
      if (dir < 0 && box.top < -2) return false;
      const target = els[i + dir];
      if (!target) return false;
      window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY, behavior: smooth ? "smooth" : "auto" });
      busyUntil = performance.now() + (smooth ? 650 : 0);
      return true;
    };
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      const now = performance.now();
      if (now - lastWheel > GESTURE_GAP) armed = true;
      lastWheel = now;
      if (!armed || now < busyUntil) {
        e.preventDefault();
        return;
      }
      if (jump(e.deltaY > 0 ? 1 : -1)) {
        armed = false;
        e.preventDefault();
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName))) return;
      const dir = e.key === "PageDown" || (e.key === " " && !e.shiftKey) ? 1 : e.key === "PageUp" || (e.key === " " && e.shiftKey) ? -1 : 0;
      if (dir !== 0 && performance.now() >= busyUntil && jump(dir)) e.preventDefault();
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
    };
  }, [chapters]);

  return (
    <nav ref={ref} className="l-rail" aria-label="Chapters">
      {chapters.map((c) => (
        <button
          key={c.label}
          type="button"
          className={c.el === active ? "on" : undefined}
          aria-current={c.el === active ? "step" : undefined}
          onClick={() => c.el.scrollIntoView({ behavior: "smooth" })}
        >
          <span>{c.label}</span>
          <i />
        </button>
      ))}
    </nav>
  );
}
