import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { effectiveBand } from "@shared/noise";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export const pct = (rate: number): string => `${Math.round(rate * 100)}%`;
/** A signed change in percentage points, one decimal. */
export const pp = (delta: number): string => `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta * 100).toFixed(1)} pp`;
/** A noise band as "±n pp", floored the way CI judges a change. */
export const band = (b: number): string => `±${Math.round(effectiveBand(b) * 100)} pp`;

export type Tone = "neutral" | "accent" | "pos" | "neg" | "warn";

export function Pill(props: { tone?: Tone; children: ReactNode; title?: string }): ReactNode {
  const tone = props.tone ?? "neutral";
  return <span title={props.title} className={cx("pill", tone === "accent" ? "acc" : tone !== "neutral" && tone)}>{props.children}</span>;
}

export function Panel(props: { title?: ReactNode; meta?: ReactNode; lede?: ReactNode; className?: string; flush?: boolean; children: ReactNode }): ReactNode {
  return (
    <section className={cx("panel", props.flush && "flush", props.className)}>
      {(props.title !== undefined || props.meta !== undefined) && (
        <header>
          {props.title !== undefined && <h2>{props.title}</h2>}
          {props.meta !== undefined && <div className="meta">{props.meta}</div>}
        </header>
      )}
      {props.lede !== undefined && <p className="lede">{props.lede}</p>}
      {props.children}
    </section>
  );
}

export function TitleRow(props: { title: ReactNode; sub?: ReactNode; meta?: ReactNode; actions?: ReactNode }): ReactNode {
  return (
    <div className="title-row">
      <div>
        <h1>{props.title}</h1>
        {props.sub !== undefined && <p className="sub">{props.sub}</p>}
        {props.meta !== undefined && <div className="meta">{props.meta}</div>}
      </div>
      {props.actions !== undefined && <div className="actions">{props.actions}</div>}
    </div>
  );
}

export interface KpiItem {
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: ReactNode;
}

export function Kpis(props: { items: KpiItem[] }): ReactNode {
  return (
    <div className="kpis">
      {props.items.map((k) => (
        <div key={k.label} className="kpi">
          <div className="kpi-label">{k.label}</div>
          <div className="kpi-value">{k.value}{k.unit && <small>{k.unit}</small>}</div>
          {k.delta !== undefined && <div className="delta">{k.delta}</div>}
        </div>
      ))}
    </div>
  );
}

export function Empty(props: { children: ReactNode }): ReactNode {
  return <div className="empty">{props.children}</div>;
}

export function Loading(props: { children: ReactNode }): ReactNode {
  return <div className="empty"><span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><Loader2 size={15} className="spin" /> {props.children}</span></div>;
}

/** A 0..1 track: the true ratio filled in the data hue, an optional ± band and a tick at a comparison value. */
export function Track(props: { value: number; noise?: number | null; tick?: number | null; muted?: boolean; label?: string }): ReactNode {
  const v = Math.max(0, Math.min(1, props.value));
  const noise = props.noise ?? null;
  return (
    <div className="track" role="img" aria-label={props.label ?? pct(v)}>
      {noise !== null && noise > 0 && <span className="band" style={{ left: `${Math.max(0, v - noise) * 100}%`, width: `${(Math.min(1, v + noise) - Math.max(0, v - noise)) * 100}%` }} />}
      <span className="fill" style={{ width: `${v * 100}%`, background: props.muted ? "var(--chart-band)" : undefined }} />
      {props.tick !== undefined && props.tick !== null && <span className="tick" style={{ left: `${Math.max(0, Math.min(1, props.tick)) * 100}%` }} />}
    </div>
  );
}

const TINTS = [
  ["#e4f0ec", "#1d4f40"], ["#f3e8dc", "#5c3b17"], ["#e3ebf6", "#1f3f6b"], ["#f4e3e6", "#6a2333"],
  ["#ecf0dc", "#45501a"], ["#e9e4f1", "#3f2f63"], ["#e0eef1", "#174a55"], ["#f4ecd8", "#5e4512"],
] as const;

function hash(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** A persona's initial on a pale tint of their own hue: identity, not data. */
export function Who(props: { name: string; seed: string }): ReactNode {
  const [bg, ink] = TINTS[hash(props.seed) % TINTS.length]!;
  const initial = props.name.trim().split(/\s+/).at(-1)?.[0] ?? "?";
  return <span className="who-chip" style={{ background: bg, color: ink }} aria-hidden>{initial}</span>;
}

export function hostOf(source: string): string {
  try {
    return new URL(source).hostname.replace(/^www\./, "");
  } catch {
    return source;
  }
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
