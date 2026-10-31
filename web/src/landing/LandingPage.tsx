import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import type { FolkVersion, Scenario } from "@shared/schema";
import { api, type PolicyDetail } from "../api";
import { useRun } from "../hooks";
import { CLASS_LABEL, CLASS_MEANING, cohortSize, misreadings, originalReadings, type Misreading, type RunModel } from "../model";
import { beyondNoise, effectiveBand } from "@shared/noise";
import { pct } from "../ui";
import { tunnelData, type TunnelData } from "./tunnel";
import "./landing.css";
// three.js is large; only the landing page pays for it.
const WindTunnel = lazy(() => import("./WindTunnel").then((m) => ({ default: m.WindTunnel })));

/** The run the page is built from, and the two edit tests run on its readers. */
const FEATURED = "cod-main";
const EDIT_TESTS = ["cod-main-rt1", "cod-main-rt2"] as const;
const REPORT = `#/run/${FEATURED}`;
const LIVE = `#/live/${FEATURED}`;

function scrollTo(id: string): void {
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById(id)?.scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
}

/** Reveal each `[data-rise]` child once its section enters; content stays visible if this never runs. */
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
        const el = entry.target as HTMLElement;
        el.classList.replace("rise-wait", "rise-in");
        io.unobserve(el);
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
  const folk = policy?.folk.versions ?? [];
  const data = useMemo(() => (model && policy ? tunnelData(model, policy.folk.versions) : null), [model, policy]);
  const rows = useMemo(() => (model ? misreadings(model) : []), [model]);
  useRise();

  useEffect(() => {
    document.title = "Policy Wind Tunnel: test how people will read a policy";
  }, []);

  return (
    <div className="landing">
      <header className="l-nav">
        <a href="#/" className="l-word"><TunnelMark />Policy Wind Tunnel</a>
        <nav aria-label="On this page">
          <button type="button" onClick={() => scrollTo("how")}>How it works</button>
          <button type="button" onClick={() => scrollTo("found")}>Findings</button>
          <button type="button" onClick={() => scrollTo("limits")}>Numbers</button>
        </nav>
        <a className="l-action" href={LIVE}>Watch it run</a>
      </header>

      <Hero model={model} data={data} />
      <How model={model} rows={rows} folk={folk} />
      <Board model={model} rows={rows} />
      <Rumours folk={folk} model={model} />
      <Measured model={model} rows={rows} folk={folk} />

      <section className="l-cta" aria-labelledby="cta-title">
        <h2 id="cta-title" className="sr-only">Watch the run</h2>
        <p data-rise>Watch the whole run, from the first reader to the last finding.</p>
        <div className="l-cta-actions" data-rise>
          <a className="l-button" href={LIVE}>Watch the run</a>
          <a className="l-link" href={REPORT}>Open the report</a>
          <a className="l-link" href="#/new">Test your own policy</a>
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

// ---------------------------------------------------------------------------
// Hero: the tunnel itself.

function Hero(props: { model: RunModel | null; data: TunnelData | null }): ReactNode {
  const { data } = props;
  const [active, setActive] = useState(0);
  const pool = data?.pools[active];
  const sentence = pool?.role === "misreading" && pool.sentenceIndex !== null ? data?.sentences[pool.sentenceIndex] : undefined;
  const told = pool ? [...pool.heard.entries()].filter(([k]) => k !== null).sort((a, b) => b[1] - a[1])[0] : undefined;
  const rumour = told ? data?.folk.get(told[0]!) : undefined;
  const heardNothingTotal = data?.streams.filter((s) => s.folkId === null).length ?? 0;
  return (
    <section className="l-hero" aria-labelledby="hero-title">
      <div className="l-hero-text">
        <h1 id="hero-title">See how readers misread a policy before it ships</h1>
        <p className="l-lede">{data ? data.total : 50} simulated Vietnamese readers read Shopee's cash-on-delivery help article. Each line is one reader.</p>
        <ul className="l-legend" aria-label="Line colours">
          <li><i className="dot rumour" />Told a rumour first</li>
          <li><i className="dot nothing" />Heard nothing</li>
        </ul>
      </div>
      <figure className="l-hero-fig">
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
                  <b>{pool.holders} of {data.total}</b> believe “{pool.label}”.{" "}
                  {!sentence && <>The text never says this. </>}
                  {told && rumour && told[1] * 2 > pool.readers && <>{told[1]} were told “{shortClaim(rumour)}” first. {(pool.heard.get(null) ?? 0) === 0 ? "None" : pool.heard.get(null)} of the {heardNothingTotal} who heard nothing.</>}
                </>
          )}
        </figcaption>
      </figure>
    </section>
  );
}

function clip(text: string, n: number): string {
  return text.length <= n ? text : `${text.slice(0, n).replace(/\s+\S*$/, "")}…`;
}

// ---------------------------------------------------------------------------
// How it works: one slider drives the stage clause and the matching fragment of the product.

const STEPS = [
  { name: "Readers", clause: "First, fifty different readers" },
  { name: "Reading", clause: "Then each reads the exact text" },
  { name: "Misreadings", clause: "Next, wrong ideas are traced" },
  { name: "Edits", clause: "Last, every edit is read again" },
] as const;

function How(props: { model: RunModel | null; rows: Misreading[]; folk: readonly FolkVersion[] }): ReactNode {
  const [step, setStep] = useState(0);
  const current = STEPS[step]!;
  return (
    <section className="l-how" id="how" aria-labelledby="how-title">
      <div className="l-how-fields">
        <div className="l-how-clause">
          <h2 id="how-title" data-rise key={step}>{current.clause}</h2>
          <a className="l-how-link" href={LIVE}>Watch every stage in the real run</a>
        </div>
        <div className="l-how-ui">
          {props.model ? <Fragment step={step} model={props.model} rows={props.rows} folk={props.folk} /> : <p className="l-muted">Loading</p>}
        </div>
      </div>
      <div className="l-slider">
        <div className="l-track" style={{ ["--done" as string]: `${(step / (STEPS.length - 1)) * 100}%` }}>
          <input
            type="range"
            min={0}
            max={STEPS.length - 1}
            step={1}
            value={step}
            aria-label="Stage"
            aria-valuetext={current.name}
            onChange={(e) => setStep(Number(e.currentTarget.value))}
          />
        </div>
        <ol>
          {STEPS.map((s, i) => (
            <li key={s.name}><button type="button" className={i === step ? "on" : undefined} onClick={() => setStep(i)}>{s.name}</button></li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Fragment(props: { step: number; model: RunModel; rows: Misreading[]; folk: readonly FolkVersion[] }): ReactNode {
  const { step, model, rows, folk } = props;
  const claim = (s: Scenario): string | null => {
    const f = folk.find((v) => v.id === s.exposure.folkVersionId);
    return f ? f.claimEn.replace(/\.$/, "") : null;
  };
  const top = rows[0];
  const holder = top ? model.scenarios.find((s) => top.readers.includes(s.id) && s.exposure.folkVersionId !== null) : undefined;
  if (step === 0) {
    const people = [model.scenarios.find((s) => s.exposure.folkVersionId === null), holder, model.scenarios.find((s) => s.exposure.folkVersionId?.includes("60"))].filter((s): s is Scenario => !!s);
    return (
      <ul className="frag frag-people" data-ui>
        {people.map((s, i) => (
          <li key={s.id} className={i === 1 ? "sel" : undefined}>
            <b>{s.persona.name}, {s.persona.age}</b>
            <span>{s.persona.occupation} · {s.persona.province}</span>
            <span className="frag-muted">{clip(s.persona.history, 90)}</span>
            <span className={claim(s) ? "frag-heard" : "frag-muted"}>{claim(s) ? `Heard: “${clip(claim(s)!, 70)}”` : "Heard nothing about the rule"}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (step === 1) {
    const reading = holder ? originalReadings(model).find((r) => r.scenarioId === holder.id) : undefined;
    const lit = reading?.interpretations.find((x) => top?.interpretationIds.includes(x.id)) ?? reading?.interpretations[0];
    return reading && holder ? (
      <div className="frag frag-reading" data-ui>
        <b>{holder.persona.name} reads the article</b>
        <p lang="vi">{clip(reading.paraphraseVi, 220)}</p>
        {lit && (
          <div className="frag-quote">
            <span className="frag-muted">On “{clip(lit.quote, 80)}”</span>
            <span>{lit.glossEn}</span>
          </div>
        )}
      </div>
    ) : <p className="l-muted">No reading yet.</p>;
  }
  if (step === 2) {
    const v0 = model.versions.find((v) => v.version === 0);
    return (
      <div className="frag frag-findings" data-ui>
        {rows.slice(0, 3).map((r, i) => {
          const sentence = v0?.sentences.find((s) => r.sentenceIds.includes(s.id));
          return (
            <div key={r.id} className={i === 0 ? "sel" : undefined}>
              <span className="frag-count">{r.readers.length}<small>/{cohortSize(model)}</small></span>
              <span><b>{r.title}</b>{r.kind && <em className={`k-${r.kind}`}>{CLASS_LABEL[r.kind]}</em>}{i === 0 && sentence && <mark lang="vi">{clip(sentence.text, 110)}</mark>}</span>
            </div>
          );
        })}
      </div>
    );
  }
  return <EditFragment />;
}

function EditFragment(): ReactNode {
  const a = useRun(EDIT_TESTS[0], false).model;
  const b = useRun(EDIT_TESTS[1], false).model;
  const tests = [a, b].filter((m): m is RunModel => !!m?.comparison);
  if (tests.length === 0) return <p className="l-muted">No edit tested yet.</p>;
  return (
    <ul className="frag frag-edits" data-ui>
      {tests.map((m, i) => {
        const c = m.comparison!;
        const before = m.versions.find((v) => v.version === 0);
        const after = m.versions.at(-1);
        // The new or changed sentence; when an edit also re-splits neighbours, the longest is the substantive one.
        const added = (after?.sentences.filter((s) => !before?.sentences.some((x) => x.text === s.text)) ?? []).sort((a, b) => b.text.length - a.text.length);
        const promise = c.fidelity?.newCommitments[0];
        return (
          <li key={m.runId} className={i === 0 ? "sel" : undefined}>
            <span className={`frag-verdict ${c.verdict}`}>{c.verdict === "pass" ? "Pass" : c.verdict === "fail" ? "Fail" : "Can't tell"}</span>
            <span>
              <b lang="vi">+ {clip(added.map((s) => changedPart(s.text, before?.sentences.map((x) => x.text) ?? [])).sort((a, b) => b.length - a.length)[0] ?? "edit", 90)}</b>
              <span className="frag-muted">{promise ? `Adds a promise the original never made: ${clip(promise, 100)}` : c.reasons.find((r) => r.includes("beyond")) ? "Another misreading rose. The rumour stayed." : clip(c.reasons[0] ?? "", 110)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** For an edited sentence, the part after what it shares with the closest original sentence. */
function changedPart(text: string, originals: readonly string[]): string {
  const clean = text.replace(/^-\s*/, "");
  let shared = 0;
  for (const o of originals) {
    const a = o.replace(/^-\s*/, "");
    let i = 0;
    while (i < a.length && i < clean.length && a[i] === clean[i]) i++;
    shared = Math.max(shared, i);
  }
  if (shared < 24) return clean;
  const cut = clean.lastIndexOf(" ", shared - 1);
  return `…${clean.slice(cut < 0 ? shared : cut + 1)}`;
}

// ---------------------------------------------------------------------------
// What it found: the misreadings as a board.

function Board(props: { model: RunModel | null; rows: Misreading[] }): ReactNode {
  const { model, rows } = props;
  const [open, setOpen] = useState(0);
  const total = model ? cohortSize(model) : 0;
  const v0 = model?.versions.find((v) => v.version === 0);
  const byId = useMemo(() => new Map((model?.scenarios ?? []).map((s) => [s.id, s])), [model]);
  return (
    <section className="l-board" id="found" aria-labelledby="found-title">
      <div className="l-section-head">
        <h2 id="found-title" data-rise>What {total || 50} readers got wrong</h2>
      </div>
      <ol className="board" data-ui>
        {rows.map((r, i) => {
          const sentence = v0?.sentences.find((s) => r.sentenceIds.includes(s.id));
          const rumourHolders = r.readers.filter((id) => byId.get(id)?.exposure.folkVersionId).length;
          const quote = model?.readings.flatMap((x) => x.interpretations).find((x) => r.interpretationIds.includes(x.id));
          return (
            <li key={r.id} className={i === open ? "open" : undefined}>
              <button type="button" aria-expanded={i === open} onClick={() => setOpen(i)}>
                <span className="b-count">{r.readers.length}</span>
                <span className="b-title">{r.title}</span>
                <span className="b-where">{sentence ? "One sentence" : r.sentenceIds.length ? "Several sentences" : "Not in the text"}</span>
                <span className="b-heard">{rumourHolders} of {r.readers.length} told a rumour</span>
                {r.kind && <span className={`b-kind k-${r.kind}`}>{CLASS_LABEL[r.kind]}</span>}
              </button>
              {i === open && (
                <div className="b-detail">
                  <p>{r.kind ? CLASS_MEANING[r.kind] : "A belief two or more readers share."}</p>
                  <p>
                    {sentence ? <>Traced to: <span lang="vi">“{clip(sentence.text, 160)}”</span></> : <>The text never addresses it.</>}
                    {quote && <> A reader: “{clip(quote.glossEn, 140)}”</>}
                  </p>
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
// The rumours readers were told, set as one sentence with one lit at a time.

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
    <section className="l-rumours" aria-labelledby="rumours-title">
      <div className="l-rumours-main">
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
          <div><dt>{told(null)}</dt><dd>heard nothing</dd></div>
        </dl>
      )}
    </section>
  );
}

/** The rumour itself, without the annotation some versions carry. */
function shortClaim(f: FolkVersion): string {
  return f.claimEn.split(";")[0]!.replace(/\s*\([^)]*\)/g, "").replace(/\.$/, "").trim();
}

// ---------------------------------------------------------------------------
// What it measured, as three small charts, and what it cannot show yet.

/** Grab's fixed-fare terms (run grab-main-noref): the accepted rewrite, read by the same readers. */
const GRAB_FIX = { before: 0.97, after: 0.62, band: 0.05 };

function Measured(props: { model: RunModel | null; rows: Misreading[]; folk: readonly FolkVersion[] }): ReactNode {
  const { model, rows, folk } = props;
  const scopeTest = useRun(EDIT_TESTS[0], false).model;
  const top = rows[0];
  const exposure = (ids: readonly string[]): Map<string | null, number> => {
    const counts = new Map<string | null, number>();
    for (const s of model?.scenarios ?? []) if (ids.includes(s.id)) counts.set(s.exposure.folkVersionId, (counts.get(s.exposure.folkVersionId) ?? 0) + 1);
    return counts;
  };
  const everyone = exposure(model?.scenarios.map((s) => s.id) ?? []);
  const holders = exposure(top?.readers ?? []);
  const rumourId = [...holders.entries()].filter(([k]) => k !== null).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const rumour = folk.find((f) => f.id === rumourId);

  const scope = scopeTest?.comparison;
  const scopeBefore = scope?.before.findingReproduction.find((r) => r.findingId === top?.id);
  const scopeAfter = scope?.after.findingReproduction.find((r) => r.findingId === top?.id);

  const systems = model?.score?.systems ?? [];
  const cases = new Set(model?.score?.matches.map((m) => m.edgeCaseId)).size;
  const tunnel = systems.find((s) => s.id === "wind-tunnel");
  const review = systems.find((s) => s.id === "baseline-mean");
  const onlyUs = model?.score?.outsideReference.filter((o) => o.systemId === "wind-tunnel").length ?? 0;

  return (
    <section className="l-limits" id="limits" aria-labelledby="limits-title">
      <div className="l-section-head">
        <h2 id="limits-title" data-rise>The numbers</h2>
        <p data-rise>All readers here are simulated. The report includes a check with real people.</p>
      </div>
      <div className="l-charts">
        <figure className="chart" data-ui data-rise>
          <figcaption>Still believe a three-failure rule after reading</figcaption>
          {top && rumour && model ? (
            <>
              <Bar label={`Told “${shortClaim(rumour)}”`} value={holders.get(rumourId) ?? 0} of={everyone.get(rumourId) ?? 0} tone="rumour" />
              <Bar label="Heard nothing" value={holders.get(null) ?? 0} of={everyone.get(null) ?? 0} tone="nothing" />
              <p>The article never contradicts the rumour.</p>
            </>
          ) : <p>Loading</p>}
        </figure>
        <figure className="chart" data-ui data-rise>
          <figcaption>Wording fixes, read by the same readers</figcaption>
          {scopeBefore && scopeAfter && scopeBefore.noiseBand !== null ? (
            <Shift label="Shopee: three-failure cutoff, after a scope sentence" before={scopeBefore.rate} after={scopeAfter.rate} band={effectiveBand(scopeBefore.noiseBand)} />
          ) : <p>Loading</p>}
          <Shift label="Grab: driver-support funding, after the rewrite" before={GRAB_FIX.before} after={GRAB_FIX.after} band={GRAB_FIX.band} />
          <p>Shaded: normal variation between two reads.</p>
        </figure>
        <figure className="chart" data-ui data-rise>
          <figcaption>Known edge cases found, scored blind</figcaption>
          {tunnel && review && cases > 0 ? (
            <>
              <Bar label="Single AI review (mean of three)" value={Math.round(review.recall * cases)} of={cases} tone="plain" />
              <Bar label="Wind tunnel" value={Math.round(tunnel.recall * cases)} of={cases} tone="accent" />
              <p>The wind tunnel also found {onlyUs} problems missing from the list.</p>
            </>
          ) : <p>Loading</p>}
        </figure>
      </div>
    </section>
  );
}

function Bar(props: { label: string; value: number; of: number; tone: "rumour" | "nothing" | "plain" | "accent" }): ReactNode {
  const share = props.of > 0 ? props.value / props.of : 0;
  return (
    <div className="bar">
      <div className="bar-head"><span>{props.label}</span><b>{props.value} of {props.of}</b></div>
      <div className="bar-track" role="img" aria-label={`${props.value} of ${props.of}`}><i className={`bar-fill ${props.tone}`} style={{ width: `${share * 100}%` }} /></div>
    </div>
  );
}

/** Before → after on the same readers, with the normal-variation band drawn around "before". */
function Shift(props: { label: string; before: number; after: number; band: number }): ReactNode {
  const { before, after, band } = props;
  const real = beyondNoise(after - before, band);
  const at = (x: number): string => `${Math.min(100, Math.max(0, x * 100))}%`;
  return (
    <div className="shift">
      <div className="bar-head"><span>{props.label}</span><b>{pct(before)} → {pct(after)}</b></div>
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
