import { Suspense, lazy, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, CircleSlash, EyeOff, FileText, PenLine, RotateCcw, ShieldCheck, ShoppingCart, X } from "lucide-react";
import type { FolkVersion, GradeLabel, Scenario } from "@shared/schema";
import { beyondNoise, effectiveBand } from "@shared/noise";
import { api, type PolicyDetail } from "../api";
import { useRun } from "../hooks";
import { cohortSize, misreadings, originalReadings, scenarioById, type Misreading, type RunModel } from "../model";
import { MisreadCost } from "./MisreadCost";
import { Pipeline, runCost } from "./Pipeline";
import { RunStory } from "./RunStory";
import { ChapterRail } from "./ChapterRail";
import { Stakes } from "./Stakes";
import { Streamlines } from "./Streamlines";
import { WhoMisreads } from "./WhoMisreads";
import { tunnelData, type TunnelData } from "./tunnel";
import "./landing.css";

// three.js is large; only the view that draws with it loads it.
const WindTunnel = lazy(() => import("./WindTunnel").then((m) => ({ default: m.WindTunnel })));

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
  const { model, events } = useRun(FEATURED, false);
  const wallSeconds = events.length > 1 ? (Date.parse(events.at(-1)!.ts) - Date.parse(events[0]!.ts)) / 1000 : null;
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
  const v0 = model?.versions.find((v) => v.version === 0);
  const sentence = (id: string): string | null => v0?.sentences.find((s) => s.id === id)?.text ?? null;
  useRise();

  return (
    <div className="landing">
      <Streamlines />
      <ChapterRail />
      <header className="l-nav">
        <a href="#/" className="l-word"><TunnelMark />Policy Wind Tunnel</a>
      </header>
      <Hook message={[sentence("checkout.1"), sentence("checkout.2")].filter((s): s is string => s !== null)} />
      <Answer text={sentence("help.4")} />
      <Blanks folk={folk} />
      <Stakes />

      <section className="l-ch l-run" id="run" aria-label="What happened in the run" data-chapter="The tunnel">
        <span className="l-kick" data-rise>So we built a wind tunnel for policy text</span>
        <RunStory model={model} top={rows[0]} folk={folk} />
      </section>

      <Found model={model} data={data} rows={rows} />
      <Voices model={model} top={rows[0]} folk={folk} />
      <Rumours folk={folk} model={model} top={rows[0]} />
      <WhoMisreads model={model} top={rows[0]} demographic={false} />
      <MisreadCost model={model} top={rows[0]} runCost={model ? runCost(model) : 0} />
      <Repair top={rows[0]} />
      <Numbers />
      <Pipeline model={model} wallSeconds={wallSeconds} />

      <section className="l-cta" id="demo" aria-labelledby="cta-title" data-chapter="Demo">
        <h2 id="cta-title" data-rise>Now watch the whole run</h2>
        <div className="l-actions" data-rise>
          <a className="l-button l-big-button" href={LIVE}>Watch the full run</a>
          <a className="l-ghost l-big-button" href={REPORT}>Open the report</a>
        </div>
        <a className="l-quiet" href="#/new" data-rise>Test your own policy →</a>
      </section>
      <footer className="l-foot">
        <span>Policy Wind Tunnel · Sea × OpenAI Codex Hackathon Vietnam, 31 October 2026</span>
        <span>Policy text quoted from help.shopee.vn. Readers are simulated.</span>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The story before the run: the hook, the official answer, the blanks people fill.

function Hook(props: { message: string[] }): ReactNode {
  return (
    <section className="l-ch l-hook" aria-labelledby="hook-title" data-chapter="Why?">
      <div className="l-hook-copy">
        <h1 id="hook-title">Cash on delivery is gone from your checkout.</h1>
        <p className="l-why">Why?</p>
      </div>
      <figure className="l-phone" aria-label="A Shopee checkout with cash on delivery unavailable">
        <figcaption lang="vi">Phương thức thanh toán</figcaption>
        <ul>
          <li><i />Ví ShopeePay</li>
          <li><i />Thẻ tín dụng/Ghi nợ</li>
          <li className="cod">
            <i />Thanh toán khi nhận hàng
            {props.message.length > 0 && <span lang="vi">{props.message.join(" ")}</span>}
          </li>
        </ul>
      </figure>
      <button type="button" className="l-scroll" aria-label="Next" onClick={() => scrollTo("answer")}><ChevronDown /></button>
    </section>
  );
}

/** The phrase in the help article that stands where a number should be. */
const VAGUE = "vượt quá quy định hiện hành";

function Answer(props: { text: string | null }): ReactNode {
  const text = props.text?.replace(/^-\s*/, "") ?? null;
  const at = text ? text.indexOf(VAGUE) : -1;
  return (
    <section className="l-ch l-answer" id="answer" aria-labelledby="answer-title" data-chapter="The rule">
      <h2 id="answer-title" data-rise>Shopee's help page gives a reason</h2>
      {text && (
        <blockquote lang="vi" data-rise>
          {at >= 0 ? <>{text.slice(0, at)}<mark>{VAGUE}</mark>{text.slice(at + VAGUE.length)}</> : text}
        </blockquote>
      )}
      <p className="l-gloss" data-rise>“…too many failed COD deliveries, beyond the current rules.”</p>
      <ul className="l-asks" aria-label="What the page leaves out">
        <li data-rise>How many?</li>
        <li data-rise>Over how long?</li>
        <li data-rise>Locked for how long?</li>
      </ul>
      <p className="l-never" data-rise>For the failed-delivery lock, the page never says.</p>
    </section>
  );
}

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function Blanks(props: { folk: readonly FolkVersion[] }): ReactNode {
  return (
    <section className="l-ch l-blanks" aria-labelledby="blanks-title" data-turbulent data-chapter="Rumours">
      <h2 id="blanks-title" data-rise>So people fill in the blanks</h2>
      <ol className="l-bubbles">
        {props.folk.map((f) => (
          <li key={f.id} data-rise><span>{shortClaim(f)}</span><small>{host(f.source)}</small></li>
        ))}
      </ol>
      <p className="l-gaps" data-rise>Each one states a rule the help article never gives.</p>
    </section>
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
// Where readers went wrong: the headline number and the tunnel.

function Found(props: { model: RunModel | null; data: TunnelData | null; rows: Misreading[] }): ReactNode {
  const { model, data, rows } = props;
  const [active, setActive] = useState(0);
  const total = model ? cohortSize(model) : 0;
  const top = rows[0];
  return (
    <section className="l-section" id="found" aria-labelledby="found-title" data-turbulent data-chapter="Finding">
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
    </section>
  );
}

// ---------------------------------------------------------------------------
// Three of them, in their own words: one per way of meeting the text.

interface Voice {
  scenario: Scenario;
  said: string;
  label: GradeLabel | null;
}

const VERDICT: Record<GradeLabel, string> = {
  outside: "Not in the text",
  conflicts: "Contradicts the text",
  consistent: "Fits the text",
  unclear: "Unclear",
};

function voicesOf(model: RunModel, top: Misreading): Voice[] {
  const holders = new Set(top.readers);
  const ids = new Set(top.interpretationIds);
  const byId = scenarioById(model);
  const picked = new Map<string, Voice>();
  const gradeOf = new Map(model.grades.map((g) => [g.interpretationId, g.label]));
  for (const r of originalReadings(model)) {
    const s = byId.get(r.scenarioId);
    // A voice for the misreading: one of its interpretations that the grader put outside or against the text.
    const it = r.interpretations.find((x) => ids.has(x.id) && (gradeOf.get(x.id) === "outside" || gradeOf.get(x.id) === "conflicts"));
    if (!s || !it || !holders.has(s.id)) continue;
    const key = sawOf(s.exposure.surfaceIds).key;
    if (picked.has(key)) continue;
    const said = it.glossEn.split(/(?<=[.!?])\s/)[0] ?? it.glossEn;
    picked.set(key, { scenario: s, said: clip(said, 170), label: gradeOf.get(it.id) ?? null });
  }
  return SAW_ORDER.flatMap((k) => picked.get(k) ?? []);
}

function Voices(props: { model: RunModel | null; top: Misreading | undefined; folk: readonly FolkVersion[] }): ReactNode {
  const { model, top, folk } = props;
  if (!model || !top) return null;
  const voices = voicesOf(model, top);
  if (voices.length === 0) return null;
  return (
    <section className="l-section" id="voices" aria-labelledby="voices-title" data-turbulent data-chapter="Voices">
      <h2 id="voices-title" data-rise>Three of them, in their own words</h2>
      <ol className="l-voices">
        {voices.map(({ scenario: s, said, label }) => {
          const saw = sawOf(s.exposure.surfaceIds);
          const heard = folk.find((f) => f.id === s.exposure.folkVersionId);
          return (
            <li key={s.id} data-rise>
              <div className="v-who">
                <span className="v-avatar" aria-hidden="true">{s.persona.name.split(" ").at(-1)?.[0] ?? "?"}</span>
                <b>{s.persona.name}, {s.persona.age}</b>
                <small>{s.persona.occupation} · {s.persona.province}</small>
              </div>
              <div className="v-path">
                {heard && <span className="v-heard">Heard “{shortClaim(heard)}”</span>}
                <span className="v-saw">{saw.icon}{saw.label}</span>
              </div>
              <p className="v-said">“{said}”</p>
              {label && <span className={`v-verdict g-${label}`}>{VERDICT[label]}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Can wording fix it? The scope-sentence edit, reread by the same suite readers.

/** English for the sentence the scope edit added (a translation of the logged Vietnamese). */
const SCOPE_GLOSS = "“This article does not state how many failed deliveries count, or over what period.”";

const norm = (s: string): string => s.trim().replace(/[.。]+$/, "");

function Repair(props: { top: Misreading | undefined }): ReactNode {
  const { top } = props;
  const suite = useRun(SCOPE_TEST, false).model;
  const cmp = suite?.comparison;
  const v0 = suite?.versions.find((v) => v.version === 0);
  const v1 = suite?.versions.at(-1);
  const before = cmp?.before.findingReproduction.find((r) => r.findingId === top?.id);
  const after = cmp?.after.findingReproduction.find((r) => r.findingId === top?.id);
  if (!suite || !cmp || !v0 || !v1 || v1 === v0 || !before || !after || !cmp.fidelity) return null;
  const old = new Set(v0.sentences.map((s) => norm(s.text)));
  const added = v1.sentences.filter((s) => !old.has(norm(s.text)));
  const worse = cmp.after.findingReproduction.flatMap((a) => {
    const b = cmp.before.findingReproduction.find((x) => x.findingId === a.findingId);
    return b && b.noiseBand !== null && a.rate > b.rate && beyondNoise(a.rate - b.rate, b.noiseBand) ? [{ before: b.rate, after: a.rate }] : [];
  })[0];
  const surface = added[0]?.id.split(".")[0] ?? null;
  const reached = surface ? suite.scenarios.filter((s) => s.exposure.surfaceIds.includes(surface)).length : 0;
  const pct = (x: number): string => `${Math.round(x * 100)}%`;
  const band = before.noiseBand === null ? null : Math.round(effectiveBand(before.noiseBand) * 100);
  return (
    <section className="l-ch l-repair" id="repair" aria-labelledby="repair-title" data-chapter="The fix">
      <span className="l-kick" data-rise>Can it be fixed?</span>
      <h2 id="repair-title" data-rise>We tried the obvious fix</h2>
      <ol className="r-steps">
        <li data-rise>
          <span className="r-icon"><PenLine /></span>
          <b>Add one sentence to the help article</b>
          {added.map((s) => <p key={s.id} lang="vi">{s.text}</p>)}
          <p className="r-gloss">{SCOPE_GLOSS}</p>
        </li>
        <li data-rise>
          <span className={cmp.fidelity.passed ? "r-icon ok" : "r-icon bad"}>{cmp.fidelity.passed ? <ShieldCheck /> : <X />}</span>
          <b>A fact check: no rule changed</b>
          <p>{cmp.fidelity.facts.filter((f) => f.entailed).length} of {cmp.fidelity.facts.length} facts kept, {cmp.fidelity.newCommitments.length} new promises.</p>
        </li>
        <li data-rise>
          <span className="r-icon"><RotateCcw /></span>
          <b>The same {suite.scenarios.length} readers read it again</b>
          <div className="r-bars" role="img" aria-label={`Three-failure belief ${pct(before.rate)} before, ${pct(after.rate)} after`}>
            <span>Before</span><i style={{ width: pct(before.rate) }} /><em>{pct(before.rate)}</em>
            <span>After</span><i style={{ width: pct(after.rate) }} /><em>{pct(after.rate)}</em>
          </div>
          <p>No real change.{worse ? ` And a different misreading rose from ${pct(worse.before)} to ${pct(worse.after)}.` : ""}</p>
        </li>
      </ol>
      <div className="r-verdict" data-rise>
        <strong>The tunnel caught a fix that would not have worked.</strong>
        {surface && <span>Only {reached} of these {suite.scenarios.length} readers ever see the help article. The rest meet the rule at checkout or hear it from a friend.</span>}
      </div>
      <People total={suite.scenarios.length} lit={reached} tone="cyan" />
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
    <section className="l-section l-rumour" id="rumours" aria-labelledby="rumours-title" data-turbulent data-chapter="Rumour test">
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
// Fixes tested on the same readers.

function Numbers(): ReactNode {
  const storeTest = useRun(STORE_TEST, false).model;
  const grab = useRun(GRAB_RUN, false).model;

  const grabBefore = grab?.iterations[0]?.findingReproduction.find((r) => r.findingId === GRAB_FINDING);
  const grabAfter = grab && grab.iterations.length > 1 ? grab.iterations.at(-1)?.findingReproduction.find((r) => r.findingId === GRAB_FINDING) : undefined;
  const promise = storeTest?.comparison?.fidelity?.newCommitments[0];

  return (
    <section className="l-section" id="numbers" aria-labelledby="numbers-title" data-chapter="Every edit">
      <h2 id="numbers-title" className="l-kicker" data-rise>Every edit gets the same test</h2>
      <div className="l-fixes">
        {grabBefore && grabAfter && grabBefore.noiseBand !== null && (
          <Fix who="Grab" what="Rider clauses rewritten" before={grabBefore.rate} after={grabAfter.rate} band={effectiveBand(grabBefore.noiseBand)} n={grabBefore.n} />
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
    </section>
  );
}

/** A rewrite's effect on the same readers: mean belief score before → after, judged against normal variation. */
function Fix(props: { who: string; what: string; before: number; after: number; band: number; n: number }): ReactNode {
  const real = beyondNoise(props.after - props.before, props.band) && props.after < props.before;
  const score = (x: number): string => String(Math.round(x * 100));
  return (
    <figure className={real ? "fix good" : "fix flat"} data-rise>
      <span className="fix-mark">{real ? <Check /> : <X />}</span>
      <figcaption><b>{props.who}</b> {props.what}</figcaption>
      <strong className="fix-num">{score(props.before)}<span>→</span>{score(props.after)}</strong>
      <span className="fix-verdict">{real ? "Works" : "Within noise"}{` · ±${Math.round(props.band * 100)} noise · same ${props.n} readers`}</span>
    </figure>
  );
}
