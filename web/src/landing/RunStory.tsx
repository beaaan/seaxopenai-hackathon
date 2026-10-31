import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bot, EyeOff, FileText, ShoppingCart } from "lucide-react";
import type { FolkVersion } from "@shared/schema";
import { originalReadings, type Misreading, type RunModel } from "../model";

/** How long each beat holds, in ms; five beats loop in about half a minute. */
const BEAT_MS = 5600;
const BEATS = 5;

type Saw = "help" | "checkout" | "none";
const SAW: Array<{ key: Saw; label: string; icon: ReactNode; x: number }> = [
  { key: "help", label: "Read the help article", icon: <FileText />, x: 20 },
  { key: "checkout", label: "Saw the checkout message", icon: <ShoppingCart />, x: 50 },
  { key: "none", label: "Saw nothing official", icon: <EyeOff />, x: 80 },
];

function sawKey(surfaceIds: readonly string[]): Saw {
  if (surfaceIds.length === 0) return "none";
  return surfaceIds.includes("help") ? "help" : "checkout";
}

interface Reader {
  id: string;
  /** Position in the run's own order; the opening grid uses it so it gives nothing away. */
  order: number;
  told: boolean;
  saw: Saw;
  holds: boolean;
  /** Index among the readers sharing this `saw`, for the column layout. */
  slot: number;
  /** Added by the agent's first decision. */
  steered: boolean;
}

/** Where a reader's dot sits in each beat, as percentages of the field; `k` is its index within its verdict group. */
function position(r: Reader, beat: number, k: number): { x: number; y: number } {
  if (beat === 0) return { x: 22 + (r.order % 10) * 6.2, y: 30 + Math.floor(r.order / 10) * 11 };
  if (beat === 4) {
    const cx = r.holds ? 30 : 68;
    const cols = r.holds ? 4 : 6;
    return { x: cx + ((k % cols) - (cols - 1) / 2) * 5, y: 34 + Math.floor(k / cols) * 9 };
  }
  const col = SAW.find((s) => s.key === r.saw)!;
  return { x: col.x + ((r.slot % 4) - 1.5) * 4.6, y: 36 + Math.floor(r.slot / 4) * 9 };
}

const at = (n: number): string => `${n}%`;

function shortSaid(text: string): string {
  const said = (text.split(/(?<=[.!?;])\s|,\s(?:but|so|even|regardless)\b/)[0] ?? text).trim();
  return said.length > 84 ? `${said.slice(0, 84).replace(/\s+\S*$/, "")}…` : said;
}

/** The run told in five beats with one dot per reader: who they are, what they saw, what they said, how the agent steers, the verdict. */
export function RunStory(props: { model: RunModel | null; top: Misreading | undefined; folk: readonly FolkVersion[] }): ReactNode {
  const { model, top, folk } = props;
  const [beat, setBeat] = useState(0);
  const host = useRef<HTMLDivElement>(null);

  const data = useMemo(() => {
    if (!model || !top) return null;
    const holders = new Set(top.readers);
    const first = model.allocations.find((a) => a.batch > 0 && a.n > 0) ?? null;
    const seed = model.config?.seedSize ?? 0;
    const counts: Record<Saw, number> = { help: 0, checkout: 0, none: 0 };
    const readers: Reader[] = model.scenarios.map((s, i) => {
      const saw = sawKey(s.exposure.surfaceIds);
      return {
        id: s.id, order: i, told: s.exposure.folkVersionId !== null, saw, holds: holders.has(s.id), slot: counts[saw]++,
        steered: first !== null && i >= seed && i < seed + first.n,
      };
    });
    // One quote per column, from a reader who holds the misreading, in their own words.
    const ids = new Set(top.interpretationIds);
    const gradeOf = new Map(model.grades.map((g) => [g.interpretationId, g.label]));
    const bubbles: Array<{ reader: Reader; text: string }> = [];
    for (const key of ["help", "checkout", "none"] as const) {
      for (const r of originalReadings(model)) {
        const reader = readers.find((x) => x.id === r.scenarioId);
        if (!reader || reader.saw !== key || !reader.holds) continue;
        const it = r.interpretations.find((x) => ids.has(x.id) && gradeOf.get(x.id) !== "consistent");
        if (!it) continue;
        bubbles.push({ reader, text: shortSaid(it.glossEn) });
        break;
      }
    }
    const told = readers.filter((r) => r.told).length;
    const held = readers.filter((r) => r.holds).length;
    const rumourId = model.scenarios.find((s) => holders.has(s.id) && s.exposure.folkVersionId)?.exposure.folkVersionId;
    return { readers, bubbles, first, counts, told, held, rumour: folk.find((f) => f.id === rumourId) ?? null };
  }, [model, top, folk]);

  // Beats advance only while the stage is on screen; coming back starts the story over.
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setBeat(BEATS - 1);
      return;
    }
    let timer = 0;
    const io = new IntersectionObserver(([entry]) => {
      window.clearInterval(timer);
      if (!entry?.isIntersecting) return;
      setBeat(0);
      timer = window.setInterval(() => setBeat((b) => (b + 1) % BEATS), BEAT_MS);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => {
      io.disconnect();
      window.clearInterval(timer);
    };
  }, [data !== null]);

  if (!data) return null;
  const total = data.readers.length;
  const captions: Array<{ title: string; sub: string }> = [
    { title: `${total} AI shoppers, each a different persona`, sub: `${data.told} of them heard a rumour from a friend first.` },
    { title: "Each one reads what a real shopper would see", sub: "Shopee's help article, a checkout message reported online, or nothing at all." },
    { title: "Then we ask: what do you believe now?", sub: "Every answer is in the reader's own words." },
    {
      title: "A Codex agent decides who reads next",
      sub: data.first ? `It looks where beliefs split and sends ${data.first.n} more readers there.` : "It looks where beliefs split and sends more readers there.",
    },
    {
      title: `${data.held} of ${total} now believe a rule that isn't in the text`,
      sub: data.rumour ? `The rumour: “${data.rumour.claimEn.split(";")[0]!.replace(/\.$/, "")}”.` : "An AI checked every belief against the policy text.",
    },
  ];
  const c = captions[beat]!;
  let held = 0;
  let rest = 0;

  return (
    <div className={`story beat-${beat}`} ref={host}>
      <div className="story-cap">
        <ol className="story-steps" aria-hidden="true">
          {captions.map((_, i) => <li key={i} className={i === beat ? "now" : i < beat ? "done" : undefined}><i style={{ animationDuration: `${BEAT_MS}ms` }} /></li>)}
        </ol>
        <h2 key={`t${beat}`} aria-live="polite">{c.title}</h2>
        <p key={`s${beat}`}>{c.sub}</p>
      </div>
      <div className="story-field">
        {beat >= 1 && beat <= 3 && SAW.map((s) => (
          <div key={s.key} className="story-col" style={{ left: at(s.x) }}>
            {s.icon}<span>{s.label}</span><b>{data.counts[s.key]}</b>
          </div>
        ))}
        {beat === 4 && (
          <>
            <div className="story-col hold" style={{ left: "30%" }}><b>{data.held}</b><span>believe the rule</span></div>
            <div className="story-col" style={{ left: "68%" }}><b>{total - data.held}</b><span>did not express it</span></div>
          </>
        )}
        {data.readers.map((r) => {
          const p = position(r, beat, r.holds ? held++ : rest++);
          const speaking = beat === 2 && data.bubbles.some((b) => b.reader.id === r.id);
          const cls = ["story-dot", r.told ? "told" : "clean", beat === 4 ? (r.holds ? "holds" : "dim") : "", beat === 3 && r.steered ? "steered" : "", speaking ? "speaking" : ""].join(" ");
          return <i key={r.id} className={cls} style={{ left: at(p.x), top: at(p.y) }} />;
        })}
        {beat === 2 && data.bubbles.map((b) => {
          const col = SAW.find((s) => s.key === b.reader.saw)!;
          return <q key={b.reader.id} className="story-bubble" style={{ left: at(col.x), top: "84%" }}>{b.text}</q>;
        })}
        {beat === 3 && data.first && (
          <div className="story-agent">
            <Bot />
            <b>Reviewer agent</b>
            <span>+{data.first.n} readers</span>
          </div>
        )}
      </div>
      <div className="story-legend" aria-hidden="true">
        <span><i className="story-dot told" />told a rumour</span>
        <span><i className="story-dot clean" />heard nothing</span>
      </div>
    </div>
  );
}
