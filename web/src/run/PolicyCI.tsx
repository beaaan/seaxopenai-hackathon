import { useMemo, useState, type ReactNode } from "react";
import { Loader2, Play } from "lucide-react";
import type { SuiteComparison, Surface } from "@shared/schema";
import { beyondNoise } from "@shared/noise";
import { api } from "../api";
import { useRun, useRuns } from "../hooks";
import { codebook, finalVersion, type RunModel } from "../model";
import type { RunContext } from "../pages/RunPage";
import { Empty, Kpis, Panel, Pill, TitleRow, band, cx, errorText, pct, type Tone } from "../ui";

const VERDICT: Record<SuiteComparison["verdict"], { label: string; tone: Tone }> = {
  pass: { label: "Pass", tone: "pos" },
  fail: { label: "Fail", tone: "neg" },
  inconclusive: { label: "Inconclusive", tone: "warn" },
};

export function PolicyCI(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const runs = useRuns(3000);
  const [launched, setLaunched] = useState<string[]>([]);
  const tests = useMemo(() => {
    const ids = new Set([...(runs ?? []).filter((r) => r.runId.startsWith(`${model.runId}-rt`)).map((r) => r.runId), ...launched]);
    return [...ids].sort().reverse();
  }, [runs, launched, model.runId]);
  return (
    <>
      <TitleRow
        title="Test an edit"
        sub="Edit the text. The same readers read your version."
      />
      <div className="grid">
        <div className="c7"><Editor model={model} onLaunched={(id) => setLaunched((prev) => [id, ...prev])} /></div>
        <div className="c5">
          <Panel flush title="Edits tested" meta={tests.length ? `${tests.length}` : undefined}>
            {tests.length === 0 ? <div style={{ padding: 20 }}><Empty>No edit tested yet.</Empty></div> : (
              <ul className="rows" style={{ padding: "4px var(--card-pad) 8px" }}>{tests.map((id) => <TestRow key={id} runId={id} />)}</ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function Editor(props: { model: RunModel; onLaunched: (runId: string) => void }): ReactNode {
  const { model } = props;
  const base = model.versions.find((v) => v.version === finalVersion(model)) ?? model.versions[0];
  const [surfaces, setSurfaces] = useState<Surface[]>(() => base?.surfaces.map((s) => ({ ...s })) ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!base) return <Panel title="Edit"><Empty>Waiting for the policy text.</Empty></Panel>;
  const changed = surfaces.some((s, i) => s.text !== base.surfaces[i]?.text);
  const valid = surfaces.length > 0 && surfaces.every((s) => s.text.trim().length > 0);
  const smokeSize = Math.min(model.config?.smokeSize ?? 10, model.scenarios.length);
  const run = (smoke: boolean): void => {
    if (!changed || !valid || busy) return;
    setBusy(true);
    setError(null);
    api.retest(model.runId, surfaces, smoke).then(
      ({ runId }) => {
        setBusy(false);
        props.onLaunched(runId);
      },
      (err: unknown) => {
        setBusy(false);
        setError(errorText(err));
      },
    );
  };
  return (
    <Panel title={`Edit v${base.version}`} meta={changed ? "Edited" : "Unchanged"}>
      <div className="stack" style={{ gap: 16 }}>
        {surfaces.map((surface, i) => (
          <label key={surface.id} className="field">
            <span>{surface.label}</span>
            <textarea
              className="input"
              lang="vi"
              value={surface.text}
              onChange={(e) => setSurfaces((prev) => prev.map((s, j) => (j === i ? { ...s, text: e.target.value } : s)))}
              rows={Math.min(16, Math.max(3, Math.ceil(surface.text.length / 80)))}
            />
          </label>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 16 }}>
        <button className="btn primary" disabled={!changed || !valid || busy} onClick={() => run(true)}>{busy ? <Loader2 className="spin" /> : <Play />} Test on {smokeSize} readers</button>
        <button className="btn" disabled={!changed || !valid || busy} onClick={() => run(false)}>Full suite, {model.scenarios.length} readers</button>
        {!changed && <span className="small muted">Change the text to run a test.</span>}
        {!valid && <span className="small bad" role="alert">Enter text for every policy surface before testing.</span>}
        {error && <span className="small bad">{error}</span>}
      </div>
    </Panel>
  );
}

function TestRow(props: { runId: string }): ReactNode {
  const { model } = useRun(props.runId, false);
  const c = model?.comparison ?? null;
  const edited = model?.versions.at(-1);
  const read = model && edited ? model.readings.filter((r) => r.policyVersion === edited.version).length : 0;
  return (
    <li className="row" style={{ alignItems: "flex-start" }}>
      <a href={`#/run/${encodeURIComponent(props.runId)}`} style={{ display: "grid", gap: 4, width: "100%" }}>
        <span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
          <span className="id">{props.runId}</span>
          {c ? <Pill tone={VERDICT[c.verdict].tone}>{VERDICT[c.verdict].label}</Pill>
            : model?.status === "failed" ? <Pill tone="neg">Error</Pill>
            : <span className="live running">Reading {read}/{model?.scenarios.length || "…"}</span>}
        </span>
        {c && c.reasons[0] && <span className="small muted">{c.reasons[0]}</span>}
        {model?.error && <span className="small bad">{model.error}</span>}
      </a>
    </li>
  );
}

/** The result screen of an edit test. */
export function RetestResult(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const c = model.comparison;
  const edited = model.versions.at(-1);
  const base = c ? model.versions.find((v) => v.version === c.baseVersion) : model.versions.at(-2);
  const titles = new Map(model.findings.map((f) => [f.id, f.title]));
  const baseTexts = new Set(base?.sentences.map((s) => s.text.trim()) ?? []);
  const editedTexts = new Set(edited?.sentences.map((s) => s.text.trim()) ?? []);
  const removed = base?.sentences.filter((s) => !editedTexts.has(s.text.trim())) ?? [];
  const added = edited?.sentences.filter((s) => !baseTexts.has(s.text.trim())) ?? [];
  const read = edited ? model.readings.filter((r) => r.policyVersion === edited.version).length : 0;
  const suite = model.config?.suiteRunId ?? null;

  return (
    <>
      <TitleRow
        title="Edit test"
        sub={c ? plainVerdict(c, titles) : model.status === "failed" ? "The test stopped with an error." : `Reading the edit: ${read} of ${model.scenarios.length || "…"} readers so far.`}
        meta={<>
          <span className="id">{model.runId}</span>
          {suite && <a className="link" href={`#/run/${encodeURIComponent(suite)}/ci`}>Back to the policy</a>}
        </>}
      />
      <Kpis items={[
        { label: "Verdict", value: c ? <span className={cx("verdict", c.verdict)}>{VERDICT[c.verdict].label}</span> : model.status === "failed" ? <span className="verdict fail">Error</span> : <span className="muted">Reading</span> },
        { label: "Rules unchanged", value: c?.fidelity ? (c.fidelity.passed ? "Yes" : <span className="bad">No</span>) : <span className="dash">–</span>, delta: c?.fidelity ? (c.fidelity.passed ? "no fact dropped, nothing new promised" : "the edit changes what the policy says") : "checked against the original" },
        { label: "Readers", value: <>{c?.after.readings ?? read}<small>/ {model.scenarios.length}</small></>, delta: "the same simulated readers as before" },
        { label: "Read it twice", value: c?.after.noiseBandScenarios ?? <span className="dash">–</span>, delta: "to measure normal variation" },
      ]} />
      {c && (
        <details style={{ marginTop: "var(--gap)" }}>
          <summary className="small muted" style={{ cursor: "pointer" }}>Every check behind this verdict</summary>
          <ul className="rows">{c.reasons.map((r, i) => <li key={i} className="row small">{r}</li>)}</ul>
        </details>
      )}
      <div className="grid">
        <div className="c5">
          <Panel title="The edit" meta={`${removed.length} removed · ${added.length} added`}>
            <div className="stack" style={{ gap: 8 }}>
              {removed.map((s) => <div key={`-${s.id}`} className="diff" style={{ gridTemplateColumns: "1fr" }}><div className="before">{s.text}</div></div>)}
              {added.map((s) => <div key={`+${s.id}`} className="diff" style={{ gridTemplateColumns: "1fr" }}><div className="after">{s.text}</div></div>)}
              {removed.length === 0 && added.length === 0 && <p className="muted">No sentence changed.</p>}
            </div>
          </Panel>
        </div>
        <div className="c7">
          <Panel flush title="Each misreading, same readers" meta={c ? `${c.after.readings} readers` : undefined}>
            {!c ? <div style={{ padding: 20 }}><Empty>The comparison appears when every reader has read the edit.</Empty></div> : (
              <div className="table-wrap" style={{ marginTop: 4 }}>
                <table>
                  <thead><tr><th>Misreading</th><th className="n">Before</th><th className="n">After</th><th className="n">Normal variation</th></tr></thead>
                  <tbody>
                    <tr>
                      <td>Readings that contradict the policy</td>
                      <td className="n">{pct(c.before.conflictRate)}</td>
                      <td className="n">{pct(c.after.conflictRate)}</td>
                      <td className="n muted">{c.after.noiseBand === null ? "–" : band(c.after.noiseBand)}</td>
                    </tr>
                    {c.before.findingReproduction.map((row) => {
                      const after = c.after.findingReproduction.find((r) => r.findingId === row.findingId);
                      const delta = after && after.n > 0 && row.n > 0 ? after.rate - row.rate : null;
                      const beyond = delta !== null && row.noiseBand !== null && beyondNoise(delta, row.noiseBand);
                      return (
                        <tr key={row.findingId}>
                          <td>{titles.get(row.findingId) ?? row.findingId}</td>
                          <td className="n">{row.n === 0 ? <span className="dash">–</span> : pct(row.rate)}</td>
                          <td className={cx("n", beyond && delta !== null && (delta < 0 ? "good" : "bad"))}>{after && after.n > 0 ? pct(after.rate) : <span className="dash">–</span>}</td>
                          <td className="n muted">{row.noiseBand === null ? "not measured" : band(row.noiseBand)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

/** One sentence a first-time viewer can read: why the edit passed, failed or could not be judged. */
function plainVerdict(c: SuiteComparison, titles: Map<string, string>): string {
  if (c.fidelity && !c.fidelity.passed) {
    const promise = c.fidelity.newCommitments[0];
    const lost = c.fidelity.facts.find((f) => !f.entailed);
    return promise ? `Fails: the edit promises something the original never did (${promise.replace(/\.$/, "")}).` : lost ? `Fails: the edit no longer says something the original did (${lost.why.replace(/\.$/, "")}).` : "Fails: the edit changes what the policy says.";
  }
  const changes = c.before.findingReproduction.flatMap((row) => {
    const after = c.after.findingReproduction.find((r) => r.findingId === row.findingId);
    if (!after || after.n === 0 || row.n === 0 || row.noiseBand === null) return [];
    const delta = after.rate - row.rate;
    return beyondNoise(delta, row.noiseBand) ? [{ title: titles.get(row.findingId) ?? row.findingId, before: row.rate, after: after.rate, delta }] : [];
  });
  const worse = changes.find((x) => x.delta > 0);
  const better = changes.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta)[0];
  if (c.verdict === "fail" && worse) return `Fails: more readers now believe “${worse.title}” (${pct(worse.before)} → ${pct(worse.after)}), more than normal variation.`;
  if (c.verdict === "pass" && better) return `Passes: “${better.title}” fell from ${pct(better.before)} to ${pct(better.after)} of the same readers, more than normal variation, and nothing got worse.`;
  if (c.verdict === "inconclusive") return "Can't tell yet: no misreading changed by more than normal variation, or too few readers read twice to measure it.";
  return c.reasons[0] ?? "";
}
