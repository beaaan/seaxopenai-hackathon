import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, CarFront, Check, FileText, Loader2, Play, ShoppingBag } from "lucide-react";
import { api, type PolicyDetail } from "../api";
import { LivePolicyTest } from "../lab/LivePolicyTest";
import { Mark } from "../shell";
import { errorText } from "../ui";
import "../lab/lab.css";

const MIN_TEXT = 40;
// Explore omits the rewrite/evaluation loop. Fifty is the CLI and server's default
// exploration budget; the real reviewer may stop sooner when discovery saturates.
const READER_BUDGET = 50;
const TEST_SESSION_KEY = "pwt.policy-lab.test";
interface TestSession { runId: string; title: string }
const PRESETS = [
  { id: "cod", title: "Shopee COD lock", description: "Help article, then the checkout message.", Icon: ShoppingBag },
  { id: "grab-scheduled", title: "Grab scheduled rides", description: "Rider, driver and general terms, as published.", Icon: CarFront },
] as const;

/** Preserve surface order, without adding headings or changing the published words. */
function presetText(detail: PolicyDetail): string {
  return detail.package.surfaces.map((surface) => surface.text).join("\n\n");
}

export function NewPolicyPage(): ReactNode {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<Record<string, PolicyDetail | undefined>>({});
  const [presetErrors, setPresetErrors] = useState<Record<string, string | undefined>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [fill, setFill] = useState(0);
  const [test, setTest] = useState<TestSession | null>(() => {
    try {
      const raw = sessionStorage.getItem(TEST_SESSION_KEY);
      if (raw === null) return null;
      const saved: unknown = JSON.parse(raw);
      if (typeof saved === "object" && saved !== null && "runId" in saved && "title" in saved && typeof saved.runId === "string" && typeof saved.title === "string") {
        return { runId: saved.runId, title: saved.title };
      }
    } catch {
      // A malformed or unavailable session must not prevent testing a policy.
    }
    return null;
  });

  useEffect(() => {
    try {
      if (test) sessionStorage.setItem(TEST_SESSION_KEY, JSON.stringify(test));
      else sessionStorage.removeItem(TEST_SESSION_KEY);
    } catch {
      setError("This browser cannot remember the test after a reload. The live run is not affected.");
    }
  }, [test]);

  useEffect(() => {
    let alive = true;
    for (const preset of PRESETS) {
      void api.policy(preset.id).then((detail) => {
        if (alive) setPresets((previous) => ({ ...previous, [preset.id]: detail }));
      }, (err: unknown) => {
        if (alive) setPresetErrors((previous) => ({ ...previous, [preset.id]: errorText(err) }));
      });
    }
    return () => { alive = false; };
  }, []);

  const ready = title.trim().length > 0 && text.trim().length >= MIN_TEXT;
  const choose = (id: string): void => {
    const detail = presets[id];
    if (!detail) return;
    setTitle(detail.package.title);
    setText(presetText(detail));
    setSelected(id);
    setFill((previous) => previous + 1);
    setError(null);
  };
  const start = async (): Promise<void> => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const original = selected === null ? undefined : presets[selected];
      // Unedited presets retain their surfaces and reference facts. Creating a copy
      // would silently discard COD's reference and make every grade "unclear".
      const unedited = original !== undefined && title === original.package.title && text === presetText(original);
      const policyId = unedited ? original.package.id : (await api.createPolicy(title.trim(), text.trim())).id;
      const result = await api.startRun(policyId, "explore", READER_BUDGET);
      setTest({ runId: result.runId, title: title.trim() });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="policy-lab">
      <nav className="lab-nav" aria-label="Policy lab">
        <a className="lab-brand" href="#/"><Mark />Policy Wind Tunnel</a>
        <div className="lab-nav-actions">
          {test && <button className="lab-reset" type="button" title="The current run will keep running." onClick={() => { setTest(null); setError(null); }}>Test another policy</button>}
          <a className="lab-back" href="#/"><ArrowLeft aria-hidden />Back to the story</a>
        </div>
      </nav>
      <div className={`lab-content${test ? " is-live" : ""}`}>
        <header className="lab-heading">
          <span className="lab-kicker">The policy lab</span>
          <h1>Test a policy</h1>
          <p>{test ? "Watch what readers take away, then see which beliefs they share." : "See what people believe after reading the exact words you publish."}</p>
        </header>
        {test ? <LivePolicyTest runId={test.runId} title={test.title} /> : (
          <>
            <section className="lab-presets" aria-labelledby="lab-presets-title">
              <div className="lab-section-label" id="lab-presets-title">Start with a real policy, or paste your own below.</div>
              <div className="lab-preset-row">
                {PRESETS.map(({ id, title: label, description, Icon }) => (
                  <button className="lab-preset" key={id} type="button" onClick={() => choose(id)} disabled={!presets[id] || busy} aria-pressed={selected === id}>
                    <Icon className="lab-preset-icon" aria-hidden />
                    <span><strong>{label}</strong><small>{presetErrors[id] ? "Policy could not be loaded." : !presets[id] ? "Loading published text…" : description}</small></span>
                    {selected === id ? <Check aria-hidden /> : <ArrowUpRight aria-hidden />}
                  </button>
                ))}
              </div>
              {PRESETS.map(({ id }) => presetErrors[id] && <p className="lab-error" role="alert" key={id}>{presetErrors[id]}</p>)}
            </section>
            <form className="lab-form" onSubmit={(event) => { event.preventDefault(); void start(); }}>
              <fieldset className={fill > 0 ? "lab-fields is-filled" : "lab-fields"} key={fill} disabled={busy}>
                <label className="lab-field">
                  <span>Policy title</span>
                  <input value={title} onChange={(event) => { setTitle(event.target.value); setSelected(null); }} placeholder="Give this policy a name" required autoComplete="off" />
                </label>
                <label className="lab-field lab-text-field">
                  <span>The text your readers see <small>{text.trim().length.toLocaleString()} characters</small></span>
                  <textarea lang="vi" value={text} onChange={(event) => { setText(event.target.value); setSelected(null); }} rows={8} minLength={MIN_TEXT} required placeholder="Paste the full policy text here, exactly as published." aria-describedby="lab-text-help" />
                </label>
              </fieldset>
              <div className="lab-form-footer">
                <p id="lab-text-help"><FileText aria-hidden /><span>{text.trim().length > 0 && text.trim().length < MIN_TEXT ? `Add at least ${MIN_TEXT - text.trim().length} more characters.` : "Up to 50 AI readers. Every count comes from the run log."}</span></p>
                <button className="lab-primary" disabled={busy || !ready} type="submit">{busy ? <Loader2 className="spin" aria-hidden /> : <Play aria-hidden />}{busy ? "Starting the test…" : "Start the test"}</button>
              </div>
            </form>
          </>
        )}
        {error && <p className="lab-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
