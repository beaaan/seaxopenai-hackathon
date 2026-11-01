import { useState, type ReactNode } from "react";
import { Copy } from "lucide-react";
import { currentHumanResults, humanRespondentKey } from "@shared/human";
import { api } from "../api";
import type { RunContext } from "../pages/RunPage";
import { Empty, Kpis, Panel, Pill, TitleRow, errorText } from "../ui";

export function HumanCheck(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const [coding, setCoding] = useState<"idle" | "busy" | "sent" | { error: string }>("idle");
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/#/check/${encodeURIComponent(model.runId)}`;
  const titles = new Map(model.findings.map((f) => [f.id, f.title]));
  const { answers: latest, mappingsByAnswerId: mapped } = currentHumanResults(model.answers, model.mappings);
  const respondents = new Set(latest.map(humanRespondentKey)).size;
  const unmapped = latest.filter((a) => !mapped.has(a.id)).length;
  const matched = [...mapped.values()].filter((m) => m.findingId !== null).length;

  return (
    <>
      <TitleRow
        title="Ask real people"
        sub={latest.length === 0 ? "Send the link to people nearby. They read the original on their phone and answer three questions." : <>{matched} of {mapped.size} coded answers match a simulated misreading.</>}
        actions={unmapped > 0 ? (
          <button
            className="btn primary"
            disabled={coding === "busy"}
            onClick={() => {
              setCoding("busy");
              api.mapAnswers(model.runId).then(() => setCoding("sent"), (err: unknown) => setCoding({ error: errorText(err) }));
            }}
          >
            Code {unmapped} new answer{unmapped > 1 ? "s" : ""}
          </button>
        ) : undefined}
      />
      {typeof coding === "object" && <div className="notice bad">{coding.error}</div>}
      {latest.some((answer) => answer.respondentId === null) && <div className="notice">Older answers used names as identity. Their people count may combine participants with the same name.</div>}
      {coding === "sent" && unmapped > 0 && <div className="notice">Coding on the frozen codebook; results appear below as they land.</div>}
      {model.questions.length === 0 ? <Empty>Questions are written after the findings.</Empty> : (
        <>
          <Kpis items={[
            { label: "People", value: respondents },
            { label: "Answers", value: latest.length, delta: unmapped ? `${unmapped} not coded yet` : latest.length ? "all coded" : undefined },
            { label: "Match a simulated misreading", value: matched, delta: mapped.size ? `of ${mapped.size} coded` : undefined },
          ]} />
          <div className="grid">
            <div className="c5">
              <Panel title="Ask people nearby" meta="Phone page, Vietnamese">
                <p className="muted">Answers are coded on the same frozen codebook as the simulated readers, so a match means a real person holds the same belief.</p>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <input className="input id" readOnly value={url} style={{ color: "var(--text)" }} onFocus={(e) => e.target.select()} />
                  <button className="btn" onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}><Copy /> {copied ? "Copied" : "Copy"}</button>
                </div>
                <a className="link small" href={url} style={{ display: "inline-block", marginTop: 8 }}>Open the phone page</a>
              </Panel>
            </div>
            <div className="c7 stack">
              {model.questions.map((q, i) => {
                const answers = latest.filter((a) => a.questionId === q.id);
                return (
                  <Panel key={q.id} title={<span lang="vi">{i + 1}. {q.questionVi}</span>} meta={`${answers.length} ${answers.length === 1 ? "answer" : "answers"}`}>
                    <p className="small muted">Probes: {q.findingIds.map((id) => titles.get(id) ?? id).join("; ")}</p>
                    {answers.length > 0 && (
                      <ul className="rows" style={{ marginTop: 6 }}>
                        {answers.map((a) => {
                          const m = mapped.get(a.id);
                          return (
                            <li key={a.id} className="row" style={{ alignItems: "flex-start", justifyContent: "space-between" }}>
                              <span lang="vi">“{a.answerVi}” <span className="small muted">{a.respondent}</span>{m?.findingId && <span className="small muted" lang="en" style={{ display: "block" }}>Matches: {titles.get(m.findingId) ?? m.findingId}</span>}</span>
                              {m && (m.findingId ? <Pill tone="warn">Same as a finding</Pill> : <Pill tone="pos">No listed misreading</Pill>)}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </Panel>
                );
              })}
            </div>
          </div>
        </>
      )}
    </>
  );
}
