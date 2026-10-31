import type { ReactNode } from "react";
import { FilePlus2 } from "lucide-react";
import type { RunSummary } from "@shared/events";
import { useRuns } from "../hooks";
import { Empty, Loading, Panel, Pill, TitleRow, type Tone } from "../ui";

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
  return "Run";
}

export function RunsPage(): ReactNode {
  const runs = useRuns();
  const sorted = [...(runs ?? [])].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  const main = sorted.filter((r) => kind(r) === "Run");
  const other = sorted.filter((r) => kind(r) !== "Run");
  return (
    <>
      <TitleRow
        title="Runs"
        sub="Each run has simulated Vietnamese readers read one policy, traces every shared misreading to a sentence, and keeps its readers as a suite for testing later edits."
        actions={<a className="btn primary" href="#/new"><FilePlus2 /> Test a new policy</a>}
      />
      {runs === null ? <Loading>Loading runs</Loading> : sorted.length === 0 ? <Empty>No runs yet. Start one with npm run pwt -- run cod, or test a new policy.</Empty> : (
        <div className="stack">
          <RunTable title="Policy runs" runs={main} />
          {other.length > 0 && <RunTable title="Edit tests and development runs" runs={other} showKind />}
        </div>
      )}
    </>
  );
}

function RunTable(props: { title: string; runs: RunSummary[]; showKind?: boolean }): ReactNode {
  return (
    <Panel flush title={props.title} meta={`${props.runs.length} runs`}>
      {props.runs.length === 0 ? <div style={{ padding: 20 }}><Empty>None yet.</Empty></div> : (
        <div className="table-wrap" style={{ marginTop: 4 }}>
          <table>
            <thead><tr><th>Run</th><th>Policy</th>{props.showKind && <th className="hide-phone">Kind</th>}<th className="hide-phone">Started</th><th className="n">Events</th><th className="n">Status</th></tr></thead>
            <tbody>
              {props.runs.map((run) => (
                <tr key={run.runId} className="pick" onClick={() => { window.location.hash = `#/run/${encodeURIComponent(run.runId)}`; }}>
                  <td><a className="id" style={{ color: "var(--text)" }} href={`#/run/${encodeURIComponent(run.runId)}`}>{run.runId}</a></td>
                  <td>{run.policyId ?? <span className="dash">–</span>}</td>
                  {props.showKind && <td className="hide-phone muted">{kind(run)}</td>}
                  <td className="hide-phone muted">{run.startedAt ? new Date(run.startedAt).toLocaleString() : <span className="dash">–</span>}</td>
                  <td className="n">{run.events}</td>
                  <td className="n"><Pill tone={STATUS[run.status].tone}>{STATUS[run.status].label}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
