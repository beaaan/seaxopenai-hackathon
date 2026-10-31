import type { ReactNode } from "react";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export const pct = (rate: number, digits = 0): string => `${(rate * 100).toFixed(digits)}%`;
export const pp = (delta: number): string => `${delta > 0 ? "+" : ""}${(delta * 100).toFixed(1)} pp`;

export type Tone = "neutral" | "accent" | "good" | "warn" | "bad" | "info";

const TONE: Record<Tone, string> = {
  neutral: "bg-stone-100 text-stone-700 ring-stone-200",
  accent: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  good: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warn: "bg-amber-50 text-amber-800 ring-amber-200",
  bad: "bg-rose-50 text-rose-700 ring-rose-200",
  info: "bg-sky-50 text-sky-700 ring-sky-200",
};

export function Badge(props: { tone?: Tone; children: ReactNode; title?: string; className?: string }): ReactNode {
  return (
    <span title={props.title} className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", TONE[props.tone ?? "neutral"], props.className)}>
      {props.children}
    </span>
  );
}

export function Card(props: { children: ReactNode; className?: string; onClick?: () => void; active?: boolean }): ReactNode {
  const interactive = props.onClick !== undefined;
  return (
    <div
      onClick={props.onClick}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); props.onClick?.(); } } : undefined}
      className={cx(
        "rounded-2xl border bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
        props.active ? "border-indigo-400 ring-2 ring-indigo-100" : "border-stone-200",
        interactive && "cursor-pointer transition hover:border-stone-300 hover:shadow-md",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

export function Section(props: { id: string; title: string; kicker?: string; aside?: ReactNode; children: ReactNode }): ReactNode {
  return (
    <section id={props.id} className="scroll-mt-28">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          {props.kicker && <div className="text-xs font-semibold tracking-[0.14em] text-indigo-600 uppercase">{props.kicker}</div>}
          <h2 className="text-2xl font-semibold tracking-tight text-stone-900">{props.title}</h2>
        </div>
        {props.aside}
      </div>
      {props.children}
    </section>
  );
}

export function Stat(props: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone }): ReactNode {
  const color = props.tone === "good" ? "text-emerald-700" : props.tone === "bad" ? "text-rose-700" : props.tone === "warn" ? "text-amber-700" : "text-stone-900";
  return (
    <div className="rounded-2xl border border-stone-200 bg-white px-5 py-4">
      <div className="text-xs font-medium tracking-wide text-stone-500 uppercase">{props.label}</div>
      <div className={cx("mt-1 text-3xl font-semibold tabular-nums tracking-tight", color)}>{props.value}</div>
      {props.hint && <div className="mt-1 text-sm text-stone-500">{props.hint}</div>}
    </div>
  );
}

export function Button(props: { children: ReactNode; onClick?: () => void; kind?: "primary" | "ghost" | "subtle"; disabled?: boolean; type?: "button" | "submit"; className?: string }): ReactNode {
  const kind = props.kind ?? "primary";
  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50",
        kind === "primary" && "bg-stone-900 text-white hover:bg-stone-700",
        kind === "subtle" && "bg-stone-100 text-stone-800 hover:bg-stone-200",
        kind === "ghost" && "text-stone-600 hover:bg-stone-100 hover:text-stone-900",
        props.className,
      )}
    >
      {props.children}
    </button>
  );
}

export function Empty(props: { children: ReactNode }): ReactNode {
  return <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50/60 px-6 py-10 text-center text-sm text-stone-500">{props.children}</div>;
}

/** Horizontal bar 0..1 with an optional ± band drawn around the value. */
export function Meter(props: { value: number; band?: number | null; tone?: Tone; className?: string }): ReactNode {
  const color = props.tone === "good" ? "bg-emerald-500" : props.tone === "bad" ? "bg-rose-500" : props.tone === "warn" ? "bg-amber-500" : "bg-indigo-500";
  const band = props.band ?? null;
  return (
    <div className={cx("relative h-2 w-full rounded-full bg-stone-100", props.className)}>
      {band !== null && band > 0 && (
        <div
          className="absolute top-[-3px] h-[14px] rounded bg-stone-300/60"
          style={{ left: `${Math.max(0, props.value - band) * 100}%`, width: `${(Math.min(1, props.value + band) - Math.max(0, props.value - band)) * 100}%` }}
        />
      )}
      <div className={cx("relative h-2 rounded-full", color)} style={{ width: `${Math.max(0.01, props.value) * 100}%` }} />
    </div>
  );
}
