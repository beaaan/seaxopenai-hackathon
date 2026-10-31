import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FolkVersion } from "@shared/schema";
import { beyondNoise, effectiveBand } from "@shared/noise";
import { api, type PolicyDetail } from "../api";
import { useRun } from "../hooks";
import { CLASS_LABEL, CLASS_MEANING, cohortSize, misreadings, quoted, type Misreading, type RunModel } from "../model";
import { pct } from "../ui";
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
          <h1 id="hero-title">Watch 50 AI readers misread a policy</h1>
          <p>A real run on Shopee's cash-on-delivery policy text, replayed from its event log.</p>
          <div className="l-actions">
            <a className="l-button" href={LIVE}>Watch the full run</a>
            <a className="l-ghost" href={REPORT}>Open the report</a>
          </div>
        </div>
      </section>

      <Found model={model} data={data} rows={rows} />
      <Rumours folk={folk} model={model} />
      <Numbers model={model} rows={rows} folk={folk} />

      <section className="l-cta" aria-labelledby="cta-title">
        <h2 id="cta-title" data-rise>Test your own policy</h2>
        <p data-rise>Paste the exact text and watch the readers live.</p>
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
  const [open, setOpen] = useState(0);
  const pool = data?.pools[active];
  const sentence = pool?.role === "misreading" && pool.sentenceIndex !== null ? data?.sentences[pool.sentenceIndex] : undefined;
  const told = pool ? [...pool.heard.entries()].filter(([k]) => k !== null).sort((a, b) => b[1] - a[1])[0] : undefined;
  const rumour = told ? data?.folk.get(told[0]!) : undefined;
  const heardNothing = data?.streams.filter((s) => s.folkId === null).length ?? 0;
  const total = model ? cohortSize(model) : 0;
  const v0 = model?.versions.find((v) => v.version === 0);
  const byId = useMemo(() => new Map((model?.scenarios ?? []).map((s) => [s.id, s])), [model]);
  return (
    <section className="l-section" id="found" aria-labelledby="found-title">
      <h2 id="found-title" data-rise>Where {total || 50} readers went wrong</h2>
      <div className="l-legend" data-rise>
        <span><i className="dot rumour" />told a rumour</span>
        <span><i className="dot nothing" />heard nothing</span>
      </div>
      <figure className="l-tunnel" data-rise>
        {data ? (
          <Suspense fallback={<div className="tunnel tunnel-loading">Loading the readers</div>}>
            <WindTunnel data={data} active={active} onActive={setActive} />
          </Suspense>
        ) : <div className="tunnel tunnel-loading">Loading the readers</div>}
        <figcaption aria-live="polite">
          {pool && data && (
            pool.role === "none" ? <><b>{pool.readers} of {data.total}</b> share no wrong idea with another reader.</>
              : pool.role === "other" ? <><b>{pool.readers}</b> readers hold rarer wrong ideas.</>
                : <>
                  <b>{pool.holders} of {data.total}</b> believe {quoted(pool.label)}.{" "}
                  {pool.holders > pool.readers && <>{pool.readers} lines end here; the others belong to readers drawn to a more common idea. </>}
                  {!sentence && <>The text never says this. </>}
                  {told && rumour && told[1] * 2 > pool.readers && <>{told[1]} of these lines were told “{shortClaim(rumour)}”. {(pool.heard.get(null) ?? 0) === 0 ? "None" : pool.heard.get(null)} of the {heardNothing} who heard no rumour end here.</>}
                </>
          )}
        </figcaption>
      </figure>
      <ol className="board">
        {rows.map((r, i) => {
          const cited = v0?.sentences.filter((s) => r.sentenceIds.includes(s.id)) ?? [];
          const rumourHolders = r.readers.filter((id) => byId.get(id)?.exposure.folkVersionId).length;
          const quote = model?.readings.flatMap((x) => x.interpretations).find((x) => r.interpretationIds.includes(x.id));
          return (
            <li key={r.id} className={i === open ? "open" : undefined} data-rise>
              <button type="button" aria-expanded={i === open} onClick={() => setOpen(i)}>
                <span className="b-count">{r.readers.length}</span>
                <span className="b-title">{r.title}</span>
                <span className="b-heard">{rumourHolders} of {r.readers.length} told a rumour</span>
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

// ---------------------------------------------------------------------------
// The rumours readers were told, one lit at a time.

function Rumours(props: { folk: readonly FolkVersion[]; model: RunModel | null }): ReactNode {
  const { folk, model } = props;
  const [lit, setLit] = useState(0);
  useEffect(() => {
    if (folk.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      if (!document.hidden) setLit((i) => (i + 1) % folk.length);
    }, 2000);
    return () => window.clearInterval(id);
  }, [folk.length]);
  const told = (id: string | null): number => model?.scenarios.filter((s) => s.exposure.folkVersionId === id).length ?? 0;
  return (
    <section className="l-section l-rumours" id="rumours" aria-labelledby="rumours-title">
      <div>
        <h2 id="rumours-title" data-rise>What people hear instead of the rule</h2>
        <p className="l-statement" data-rise>
          {folk.map((f, i) => (
            <span key={f.id} className={i === lit ? "lit" : undefined}>“{shortClaim(f)}”{i < folk.length - 1 ? ", " : "."}</span>
          ))}
        </p>
        <p className="l-note" data-rise>Shopee's article states none of these.</p>
      </div>
      {model && (
        <dl className="l-told" data-rise aria-label="What readers were told before reading">
          {folk.filter((f) => told(f.id) > 0).map((f) => (
            <div key={f.id}><dt>{told(f.id)}</dt><dd>told “{shortClaim(f)}”</dd></div>
          ))}
          <div className="nothing"><dt>{told(null)}</dt><dd>heard nothing</dd></div>
        </dl>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The numbers, as three charts.

/** What a reader saw of the official text, by surface ids. */
function sawLabel(surfaceIds: readonly string[]): string {
  if (surfaceIds.length === 0) return "saw no official text";
  if (surfaceIds.length === 1 && surfaceIds[0] === "help") return "read the help article";
  if (surfaceIds.length === 1 && surfaceIds[0] === "checkout") return "saw the checkout message";
  return `saw ${surfaceIds.join(" and ")}`;
}

function Numbers(props: { model: RunModel | null; rows: Misreading[]; folk: readonly FolkVersion[] }): ReactNode {
  const { model, rows, folk } = props;
  const scopeTest = useRun(SCOPE_TEST, false).model;
  const storeTest = useRun(STORE_TEST, false).model;
  const grab = useRun(GRAB_RUN, false).model;
  const top = rows[0];
  const scenarios = model?.scenarios ?? [];
  const holderSet = new Set(top?.readers ?? []);
  const told = new Map<string, number>();
  for (const s of scenarios) if (holderSet.has(s.id) && s.exposure.folkVersionId) told.set(s.exposure.folkVersionId, (told.get(s.exposure.folkVersionId) ?? 0) + 1);
  const rumourId = [...told.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const rumour = folk.find((f) => f.id === rumourId);
  // Readers told the rumour, split by what they saw of the official text; then everyone who heard no rumour.
  const groups = new Map<string, { label: string; of: number; hold: number }>();
  for (const s of scenarios) {
    if (s.exposure.folkVersionId !== rumourId) continue;
    const label = sawLabel(s.exposure.surfaceIds);
    const g = groups.get(label) ?? { label, of: 0, hold: 0 };
    g.of++;
    if (holderSet.has(s.id)) g.hold++;
    groups.set(label, g);
  }
  const none = scenarios.filter((s) => s.exposure.folkVersionId === null);
  const noneHold = none.filter((s) => holderSet.has(s.id)).length;

  const grabBefore = grab?.iterations[0]?.findingReproduction.find((r) => r.findingId === GRAB_FINDING);
  const grabAfter = grab && grab.iterations.length > 1 ? grab.iterations.at(-1)?.findingReproduction.find((r) => r.findingId === GRAB_FINDING) : undefined;

  const scope = scopeTest?.comparison;
  const scopeBefore = scope?.before.findingReproduction.find((r) => r.findingId === top?.id);
  const scopeAfter = scope?.after.findingReproduction.find((r) => r.findingId === top?.id);
  const promise = storeTest?.comparison?.fidelity?.newCommitments[0];

  const systems = model?.score?.systems ?? [];
  const cases = new Set(model?.score?.matches.map((m) => m.edgeCaseId)).size;
  const tunnel = systems.find((s) => s.id === "wind-tunnel");
  const review = systems.find((s) => s.id === "baseline-mean");
  const onlyUs = model?.score?.outsideReference.filter((o) => o.systemId === "wind-tunnel").length ?? 0;

  return (
    <section className="l-section" id="numbers" aria-labelledby="numbers-title">
      <h2 id="numbers-title" data-rise>The numbers</h2>
      <p className="l-note" data-rise>All readers are simulated. No real-reader answers are recorded yet.</p>
      <div className="l-charts">
        <figure className="chart" data-rise>
          <figcaption>Hold the three-failure rule, by what they saw</figcaption>
          {top && rumour && model ? (
            <>
              <p>Told “{shortClaim(rumour)}”, then:</p>
              {[...groups.values()].sort((a, b) => a.label.localeCompare(b.label)).map((g) => <Bar key={g.label} label={g.label} value={g.hold} of={g.of} tone="amber" />)}
              <Bar label="Heard no rumour (any text)" value={noneHold} of={none.length} tone="cyan" />
            </>
          ) : <p>Loading</p>}
        </figure>
        <figure className="chart" data-rise>
          <figcaption>Edits, read again by the same readers</figcaption>
          {scopeBefore && scopeAfter && scopeBefore.noiseBand !== null ? (
            <Shift label={`Shopee: scope sentence added · n=${scopeBefore.n}`} before={scopeBefore.rate} after={scopeAfter.rate} band={effectiveBand(scopeBefore.noiseBand)} tag={scope?.verdict === "fail" ? "Failed" : undefined} />
          ) : null}
          {grabBefore && grabAfter && grabBefore.noiseBand !== null && (
            <Shift label={`Grab: rider clauses rewritten · n=${grabBefore.n}`} before={grabBefore.rate} after={grabAfter.rate} band={effectiveBand(grabBefore.noiseBand)} />
          )}
          {promise && (
            <div className="shift">
              <div className="bar-head"><span>Shopee: “pay at a convenience store”</span><b className="bad">Rejected</b></div>
              <span className="shift-verdict bad">Promises something the original never did</span>
            </div>
          )}
        </figure>
        <figure className="chart" data-rise>
          <figcaption>Known edge cases found, scored blind</figcaption>
          {tunnel && review && cases > 0 ? (
            <>
              <Bar label="Single AI review (mean of three)" value={Math.round(review.recall * cases)} of={cases} tone="plain" />
              <Bar label="Wind tunnel" value={Math.round(tunnel.recall * cases)} of={cases} tone="green" />
              <p>{onlyUs} wind-tunnel findings matched no listed edge case; they are not validated.</p>
            </>
          ) : <p>Loading</p>}
        </figure>
      </div>
    </section>
  );
}

function Bar(props: { label: string; value: number; of: number; tone: "amber" | "cyan" | "plain" | "green" }): ReactNode {
  const share = props.of > 0 ? props.value / props.of : 0;
  return (
    <div className="bar">
      <div className="bar-head"><span>{props.label}</span><b>{props.value} of {props.of}</b></div>
      <div className="bar-track" role="img" aria-label={`${props.value} of ${props.of}`}><i className={`bar-fill ${props.tone}`} style={{ width: `${share * 100}%` }} /></div>
    </div>
  );
}

/** Before → after on the same readers, with the normal-variation band drawn around "before". */
function Shift(props: { label: string; before: number; after: number; band: number; tag?: string }): ReactNode {
  const { before, after, band } = props;
  const real = beyondNoise(after - before, band);
  const at = (x: number): string => `${Math.min(100, Math.max(0, x * 100))}%`;
  return (
    <div className="shift">
      <div className="bar-head"><span>{props.label}</span><b>{pct(before)} → {pct(after)}{props.tag && <em className="bad"> {props.tag}</em>}</b></div>
      <div className="shift-track" role="img" aria-label={`${pct(before)} before, ${pct(after)} after, normal variation ±${Math.round(band * 100)} points`}>
        <i className="shift-band" style={{ left: at(before - band), width: `${Math.min(before + band, 1) * 100 - Math.max(before - band, 0) * 100}%` }} />
        <i className="shift-line" style={{ left: at(Math.min(before, after)), width: `${Math.abs(after - before) * 100}%` }} />
        <i className="shift-dot before" style={{ left: at(before) }} />
        <i className={`shift-dot after ${real ? "real" : ""}`} style={{ left: at(after) }} />
      </div>
      <span className={real ? "shift-verdict real" : "shift-verdict"}>{real ? "Beyond normal variation" : "Within normal variation"}</span>
    </div>
  );
}
