import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, FilePlus2 } from "lucide-react";
import type { RunSummary } from "@shared/events";
import { api, type PolicyDetail } from "../api";
import { useRun, useRuns } from "../hooks";
import { CLASS_LABEL, cohortSize, misreadings, originalReadings } from "../model";
import { Empty, Loading, Panel, Pill, TitleRow, hostOf, type Tone } from "../ui";

const STATUS: Record<RunSummary["status"], { label: string; tone: Tone }> = {
  running: { label: "Running", tone: "accent" },
  completed: { label: "Completed", tone: "neutral" },
  failed: { label: "Failed", tone: "neg" },
  unknown: { label: "No log", tone: "neutral" },
};

function kind(run: RunSummary): string {
  if (run.runId.includes("-rt")) return "Edit test";
  if (run.runId.startsWith("fixture")) return "Synthetic fixture";
  if (run.runId.startsWith("dev-")) return "Development";
  return "Policy test";
}

export function RunsPage(): ReactNode {
  const runs = useRuns();
  const sorted = [...(runs ?? [])].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  // The latest real test of each policy.
  const latest = new Map<string, RunSummary>();
  for (const run of sorted) if (kind(run) === "Policy test" && run.policyId && !latest.has(run.policyId)) latest.set(run.policyId, run);
  return (
    <>
      <TitleRow
        title="Policy Wind Tunnel"
        sub="Test how people will read a policy before you publish it."
        actions={<a className="btn primary" href="#/new"><FilePlus2 /> Test a policy</a>}
      />
      <ol className="steps">
        <li>Give it the <b>exact text</b> of a policy, help article or notice.</li>
        <li><b>Dozens of simulated Vietnamese readers</b>, each in their own situation and some already holding a rumour, read it and say what it means and what they would do.</li>
        <li>It lists the <b>wrong ideas they share</b>, with the sentence behind each.</li>
        <li>It rewrites what wording can fix and has the <b>same readers read again</b> to prove the fix works; any later edit can be re-tested the same way.</li>
      </ol>
      {runs === null ? <Loading>Loading</Loading> : latest.size === 0 ? <Empty>No policy has been tested yet.</Empty> : (
        <div className="grid">
          {[...latest.values()].map((run) => <div key={run.runId} className="c6"><PolicyCard run={run} /></div>)}
        </div>
      )}
      {sorted.length > 0 && (
        <details className="dev-runs">
          <summary>All runs, including edit tests and development runs ({sorted.length})</summary>
          <RunTable runs={sorted} />
        </details>
      )}
    </>
  );
}

function PolicyCard(props: { run: RunSummary }): ReactNode {
  const { model } = useRun(props.run.runId, false);
  const [policy, setPolicy] = useState<PolicyDetail | null>(null);
  useEffect(() => {
    if (props.run.policyId === null) return;
    let alive = true;
    api.policy(props.run.policyId).then((p) => alive && setPolicy(p), () => {});
    return () => {
      alive = false;
    };
  }, [props.run.policyId]);
  const href = `#/run/${encodeURIComponent(props.run.runId)}`;
  const rows = model ? misreadings(model) : [];
  const total = model ? cohortSize(model) : 0;
  const top = rows[0];
  const count = (k: keyof typeof CLASS_LABEL): number => model?.findings.filter((f) => f.class === k).length ?? 0;
  return (
    <Panel title={policy?.package.title ?? props.run.policyId ?? props.run.runId} meta={policy?.package.sourceUrls[0] ? hostOf(policy.package.sourceUrls[0]) : undefined}>
      {model === null ? <p className="muted">Loading</p> : model.status === "running" && model.findings.length === 0 ? (
        <p className="muted">Test in progress: {originalReadings(model).length} of {model.scenarios.length || "…"} simulated readers have read it.</p>
      ) : (
        <>
          <p className="muted">{total} simulated readers read the exact text.</p>
          {top && (
            <div className="headline-row">
              <span className="count num">{top.readers.length}<small>of {total}</small></span>
              <span>came away believing: <b style={{ fontWeight: 500 }}>{top.title}</b></span>
            </div>
          )}
          {model.findings.length > 0 && (
            <div className="pills" style={{ marginTop: 12 }}>
              {(["wording_fix", "design_gap", "unresolvable"] as const).filter((k) => count(k) > 0).map((k) => <Pill key={k}>{count(k)} {CLASS_LABEL[k].toLowerCase()}</Pill>)}
              {(["wording_fix", "design_gap", "unresolvable"] as const).filter((k) => count(k) > 0).map((k) => <Pill key={k}>{CLASS_LABEL[k]}: {count(k)}</Pill>)}
            </div>
          )}
        </>
      )}
      <a className="btn" href={href} style={{ marginTop: 16 }}>Open the report <ArrowRight /></a>
    </Panel>
  );
}

function RunTable(props: { runs: RunSummary[] }): ReactNode {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Run</th><th>Policy</th><th className="hide-phone">Kind</th><th className="hide-phone">Started</th><th className="n">Status</th></tr></thead>
        <tbody>
          {props.runs.map((run) => (
            <tr key={run.runId} className="pick" onClick={() => { window.location.hash = `#/run/${encodeURIComponent(run.runId)}`; }}>
              <td><a className="id" style={{ color: "var(--text)" }} href={`#/run/${encodeURIComponent(run.runId)}`}>{run.runId}</a></td>
              <td>{run.policyId ?? <span className="dash">–</span>}</td>
              <td className="hide-phone muted">{kind(run)}</td>
              <td className="hide-phone muted">{run.startedAt ? new Date(run.startedAt).toLocaleString() : <span className="dash">–</span>}</td>
              <td className="n"><Pill tone={STATUS[run.status].tone}>{STATUS[run.status].label}</Pill></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
