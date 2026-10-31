import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, CircleSlash, EyeOff, FileText, ShoppingCart, X } from "lucide-react";
import type { FolkVersion } from "@shared/schema";
import { beyondNoise, effectiveBand } from "@shared/noise";
import { api, type PolicyDetail } from "../api";
import { useRun } from "../hooks";
import { CLASS_LABEL, CLASS_MEANING, cohortSize, misreadings, type Misreading, type RunModel } from "../model";
import { tunnelData, type TunnelData } from "./tunnel";
import "./landing.css";

// three.js is large; only the views that draw with it load it.
const WindTunnel = lazy(() => import("./WindTunnel").then((m) => ({ default: m.WindTunnel })));
const TheatrePage = lazy(() => import("../theatre/TheatrePage").then((m) => ({ default: m.TheatrePage })));

/** The run the page is built from, and the two edit tests run on its readers. */
const FEATURED = "cod-main";
const SCOPE_TEST = "cod-main-rt1";
const STORE_TEST = "cod-main-rt2";
const REPORT = `#/run/${FEATURED}`;
const LIVE = `#/live/${FEATURED}`;
/** Grab's scheduled-ride terms: the run whose accepted rewrite the chart shows, and the misreading it targeted. */
const GRAB_RUN = "grab-main-noref";
const GRAB_FINDING = "f4";

function scrollTo(id: string): void {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
}

/** Reveal each `[data-rise]` element once it scrolls in; content stays visible if this never runs. */
function useRise(): void {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const items = [...document.querySelectorAll<HTMLElement>(".landing [data-rise]:not(.rise-in)")];
    for (const el of items) {
      el.classList.add("rise-wait");
      const section = el.closest("section");
      const index = section ? [...section.querySelectorAll("[data-rise]")].indexOf(el) : 0;
      el.style.transitionDelay = `${Math.max(0, index) * 80}ms`;
    }
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.replace("rise-wait", "rise-in");
        io.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8% 0px" });
    for (const el of items) io.observe(el);
    return () => io.disconnect();
  });
}

export function LandingPage(): ReactNode {
  const { model } = useRun(FEATURED, false);
  const [policy, setPolicy] = useState<PolicyDetail | null>(null);
  useEffect(() => {
    let alive = true;
    api.policy("cod").then((p) => alive && setPolicy(p), () => {});
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    document.title = "Policy Wind Tunnel";
  }, []);
  const folk = policy?.folk.versions ?? [];
  const data = useMemo(() => (model && policy ? tunnelData(model, policy.folk.versions) : null), [model, policy]);
  const rows = useMemo(() => (model ? misreadings(model) : []), [model]);
  useRise();

  return (
    <div className="landing">
      <section className="l-hero" aria-labelledby="hero-title">
        <Suspense fallback={null}>
          <TheatrePage runId={FEATURED} embedded />
        </Suspense>
        <header className="l-nav">
          <a href="#/" className="l-word"><TunnelMark />Policy Wind Tunnel</a>
          <nav aria-label="On this page">
            <button type="button" onClick={() => scrollTo("found")}>Findings</button>
            <button type="button" onClick={() => scrollTo("rumours")}>Rumours</button>
            <button type="button" onClick={() => scrollTo("numbers")}>Numbers</button>
          </nav>
          <a className="l-ghost" href={REPORT}>Report</a>
        </header>
        <div className="l-hero-copy">
          <span className="l-live"><i />Live replay of a real run</span>
          <h1 id="hero-title">Watch 50 AI readers form beliefs about a policy</h1>
          <div className="l-actions">
            <a className="l-button" href={LIVE}>Watch the full run</a>
            <a className="l-ghost" href={REPORT}>Report</a>
          </div>
        </div>
      </section>

      <Found model={model} data={data} rows={rows} />
      <Rumours folk={folk} model={model} top={rows[0]} />
      <Numbers model={model} top={rows[0]} />

      <section className="l-cta" aria-labelledby="cta-title">
        <h2 id="cta-title" data-rise>Test your own policy</h2>
        <div className="l-actions" data-rise>
          <a className="l-button" href="#/new">Test a policy</a>
          <a className="l-ghost" href="#/policies">Policies tested</a>
        </div>
      </section>
      <footer className="l-foot">
        <span>Policy Wind Tunnel · Sea × OpenAI Codex Hackathon Vietnam, 31 October 2026</span>
        <span>Policy text quoted from help.shopee.vn. Readers are simulated.</span>
      </footer>
    </div>
  );
}

function TunnelMark(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M2 7c5 0 7 3 10 3s5-3 10-3M2 12h20M2 17c5 0 7-3 10-3s5 3 10 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function clip(text: string, n: number): string {
  return text.length <= n ? text : `${text.slice(0, n).replace(/\s+\S*$/, "")}…`;
}

/** The rumour itself, without the annotation some versions carry. */
function shortClaim(f: FolkVersion): string {
  return f.claimEn.split(";")[0]!.replace(/\s*\([^)]*\)/g, "").replace(/\.$/, "").trim();
}

// ---------------------------------------------------------------------------
// Where readers went wrong: the tunnel, then every misreading.

function Found(props: { model: RunModel | null; data: TunnelData | null; rows: Misreading[] }): ReactNode {
  const { model, data, rows } = props;
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const total = model ? cohortSize(model) : 0;
  const top = rows[0];
  const v0 = model?.versions.find((v) => v.version === 0);
  return (
    <section className="l-section" id="found" aria-labelledby="found-title">
      {top && total > 0 && (
        <div className="l-big" data-rise>
          <strong className="l-num"><span>{top.readers.length}</span><small>/{total}</small></strong>
          <h2 id="found-title">believe a rule that is not in the text</h2>
          <People total={total} lit={top.readers.length} />
        </div>
      )}
      <figure className="l-tunnel" data-rise>
        {data ? (
          <Suspense fallback={<div className="tunnel tunnel-loading" />}>
            <WindTunnel data={data} active={active} onActive={setActive} />
          </Suspense>
        ) : <div className="tunnel tunnel-loading" />}
      </figure>
      <ol className="board">
        {rows.map((r, i) => {
          const cited = v0?.sentences.filter((s) => r.sentenceIds.includes(s.id)) ?? [];
          const quote = model?.readings.flatMap((x) => x.interpretations).find((x) => r.interpretationIds.includes(x.id));
          return (
            <li key={r.id} className={i === open ? "open" : undefined} data-rise>
              <button type="button" aria-expanded={i === open} onClick={() => setOpen(i === open ? null : i)}>
                <span className="b-count">{r.readers.length}</span>
                <span className="b-title">{r.title}</span>
                {r.kind && <span className={`b-kind k-${r.kind}`}>{CLASS_LABEL[r.kind]}</span>}
              </button>
              {i === open && (
                <div className="b-detail">
                  <p>{r.kind ? CLASS_MEANING[r.kind] : "A belief two or more readers share."}</p>
                  {cited.length > 0 ? cited.map((s) => <p key={s.id} lang="vi" className="b-quote">{clip(s.text, 180)}</p>) : <p className="b-quote">Not in the text.</p>}
                  {quote && <p>A reader: “{clip(quote.glossEn, 160)}”</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** One dot per reader; the first `lit` glow. */
function People(props: { total: number; lit: number; tone?: "amber" | "cyan" }): ReactNode {
  return (
    <span className={`people ${props.tone ?? "amber"}`} role="img" aria-label={`${props.lit} of ${props.total}`}>
      {Array.from({ length: props.total }, (_, i) => <i key={i} className={i < props.lit ? "on" : undefined} style={{ ["--d" as string]: `${i * 18}ms` }} />)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// The rumour against the official text: who still believes it, by what they saw.

/** What a reader saw of the official text, by surface ids. */
function sawOf(surfaceIds: readonly string[]): { key: string; label: string; icon: ReactNode } {
  if (surfaceIds.length === 0) return { key: "none", label: "Saw no official text", icon: <EyeOff /> };
  if (surfaceIds.length === 1 && surfaceIds[0] === "help") return { key: "help", label: "Read the help article", icon: <FileText /> };
  if (surfaceIds.length === 1 && surfaceIds[0] === "checkout") return { key: "checkout", label: "Saw the checkout message", icon: <ShoppingCart /> };
  return { key: surfaceIds.join("+"), label: `Saw ${surfaceIds.join(" and ")}`, icon: <FileText /> };
}

const SAW_ORDER = ["help", "checkout", "none"];

function Rumours(props: { folk: readonly FolkVersion[]; model: RunModel | null; top: Misreading | undefined }): ReactNode {
  const { folk, model, top } = props;
  const scenarios = model?.scenarios ?? [];
  const holders = new Set(top?.readers ?? []);
  const told = new Map<string, number>();
  for (const s of scenarios) if (holders.has(s.id) && s.exposure.folkVersionId) told.set(s.exposure.folkVersionId, (told.get(s.exposure.folkVersionId) ?? 0) + 1);
  const rumourId = [...told.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const rumour = folk.find((f) => f.id === rumourId);
  const groups = new Map<string, { label: string; icon: ReactNode; of: number; hold: number }>();
  for (const s of scenarios) {
    if (s.exposure.folkVersionId !== rumourId) continue;
    const saw = sawOf(s.exposure.surfaceIds);
    const g = groups.get(saw.key) ?? { label: saw.label, icon: saw.icon, of: 0, hold: 0 };
    g.of++;
    if (holders.has(s.id)) g.hold++;
    groups.set(saw.key, g);
  }
  const ordered = [...groups.entries()].sort((a, b) => SAW_ORDER.indexOf(a[0]) - SAW_ORDER.indexOf(b[0]));
  const none = scenarios.filter((s) => s.exposure.folkVersionId === null);
  const noneHold = none.filter((s) => holders.has(s.id)).length;
  if (!rumour || !model) return null;
  return (
    <section className="l-section l-rumour" id="rumours" aria-labelledby="rumours-title">
      <h2 id="rumours-title" className="l-kicker" data-rise>The rumour survives the official text</h2>
      <p className="l-claim" data-rise>“{shortClaim(rumour)}”<span className="l-stamp">Not in Shopee's text</span></p>
      <p className="l-lead" data-rise>Readers told this rumour, then:</p>
      <div className="l-matrix" data-rise>
        {ordered.map(([key, g]) => (
          <div key={key} className="m-row">
            <span className="m-icon">{g.icon}</span>
            <span className="m-label">{g.label}</span>
            <People total={g.of} lit={g.hold} />
            <b>{g.hold}/{g.of}</b>
          </div>
        ))}
        <div className="m-row calm">
          <span className="m-icon"><CircleSlash /></span>
          <span className="m-label">Readers told no rumour</span>
          <People total={none.length} lit={noneHold} tone="cyan" />
          <b>{noneHold}/{none.length}</b>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Fixes tested on the same readers, and the comparison with one AI review.

function Numbers(props: { model: RunModel | null; top: Misreading | undefined }): ReactNode {
  const { model, top } = props;
  const scopeTest = useRun(SCOPE_TEST, false).model;
  const storeTest = useRun(STORE_TEST, false).model;
  const grab = useRun(GRAB_RUN, false).model;

  const grabBefore = grab?.iterations[0]?.findingReproduction.find((r) => r.findingId === GRAB_FINDING);
  const grabAfter = grab && grab.iterations.length > 1 ? grab.iterations.at(-1)?.findingReproduction.find((r) => r.findingId === GRAB_FINDING) : undefined;
  const scope = scopeTest?.comparison;
  const scopeBefore = scope?.before.findingReproduction.find((r) => r.findingId === top?.id);
  const scopeAfter = scope?.after.findingReproduction.find((r) => r.findingId === top?.id);
  // The scope edit's verdict also counts every other misreading: the largest rise beyond noise, if any.
  const scopeWorse = (scope?.after.findingReproduction ?? []).flatMap((a) => {
    const b = scope?.before.findingReproduction.find((x) => x.findingId === a.findingId);
    return b && b.noiseBand !== null && a.rate > b.rate && beyondNoise(a.rate - b.rate, b.noiseBand) ? [{ before: b.rate, after: a.rate }] : [];
  }).sort((x, y) => (y.after - y.before) - (x.after - x.before))[0];
  const promise = storeTest?.comparison?.fidelity?.newCommitments[0];

  const systems = model?.score?.systems ?? [];
  const cases = new Set(model?.score?.matches.map((m) => m.edgeCaseId)).size;
  const tunnel = systems.find((s) => s.id === "wind-tunnel");
  const review = systems.find((s) => s.id === "baseline-mean");

  return (
    <section className="l-section" id="numbers" aria-labelledby="numbers-title">
      <h2 id="numbers-title" className="l-kicker" data-rise>Test a fix before it ships</h2>
      <div className="l-fixes">
        {grabBefore && grabAfter && grabBefore.noiseBand !== null && (
          <Fix who="Grab" what="Rider clauses rewritten" before={grabBefore.rate} after={grabAfter.rate} band={effectiveBand(grabBefore.noiseBand)} n={grabBefore.n} />
        )}
        {scopeBefore && scopeAfter && scopeBefore.noiseBand !== null && (
          <Fix who="Shopee" what="Scope sentence added" before={scopeBefore.rate} after={scopeAfter.rate} band={effectiveBand(scopeBefore.noiseBand)} n={scopeBefore.n} worse={scopeWorse} />
        )}
        {promise && (
          <figure className="fix bad" data-rise>
            <span className="fix-mark"><X /></span>
            <figcaption><b>Shopee</b> “Pay at a convenience store”</figcaption>
            <strong className="fix-num">+1 promise</strong>
            <span className="fix-verdict">Rejected: the original never said it</span>
          </figure>
        )}
      </div>
      {tunnel && review && cases > 0 && (
        <div className="l-versus" data-rise>
          <h3>Known edge cases found, scored blind</h3>
          <Dots label="One AI review" hit={Math.round(review.recall * cases)} of={cases} tone="plain" />
          <Dots label="Wind tunnel" hit={Math.round(tunnel.recall * cases)} of={cases} tone="green" />
          <p>A review lists more. The tunnel counts who believes each one.</p>
        </div>
      )}
    </section>
  );
}

/**
 * A rewrite's effect on the same readers: mean belief score before → after, judged against normal variation.
 * `worse` is another misreading that rose beyond noise, which fails the edit whatever this one did.
 */
function Fix(props: { who: string; what: string; before: number; after: number; band: number; n: number; worse?: { before: number; after: number } | undefined }): ReactNode {
  const real = beyondNoise(props.after - props.before, props.band) && props.after < props.before;
  const score = (x: number): string => String(Math.round(x * 100));
  const ok = real && !props.worse;
  return (
    <figure className={ok ? "fix good" : props.worse ? "fix failed" : "fix flat"} data-rise>
      <span className="fix-mark">{ok ? <Check /> : <X />}</span>
      <figcaption><b>{props.who}</b> {props.what}</figcaption>
      <strong className="fix-num">{score(props.before)}<span>→</span>{score(props.after)}</strong>
      <span className="fix-verdict">
        {props.worse ? `Failed: another misreading rose ${score(props.worse.before)} → ${score(props.worse.after)}` : real ? "Works" : "Within noise"}
        {` · ±${Math.round(props.band * 100)} noise · same ${props.n} readers`}
      </span>
    </figure>
  );
}

function Dots(props: { label: string; hit: number; of: number; tone: "plain" | "green" }): ReactNode {
  return (
    <div className={`dots ${props.tone}`}>
      <span>{props.label}</span>
      <span className="dots-row" role="img" aria-label={`${props.hit} of ${props.of}`}>
        {Array.from({ length: props.of }, (_, i) => <i key={i} className={i < props.hit ? "on" : undefined} />)}
      </span>
      <b>{props.hit}/{props.of}</b>
    </div>
  );
}
