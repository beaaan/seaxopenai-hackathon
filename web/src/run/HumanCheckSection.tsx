import { useState, type ReactNode } from "react";
import { Smartphone } from "lucide-react";
import { api } from "../api";
import type { RunContext } from "../pages/RunPage";
import { Badge, Button, Card, Empty, Section } from "../ui";

export function HumanCheckSection(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const [mapping, setMapping] = useState<"idle" | "busy" | "sent" | string>("idle");
  const url = `${window.location.origin}/#/check/${encodeURIComponent(model.runId)}`;
  const titles = new Map(model.findings.map((f) => [f.id, f.title]));
  const mapped = new Map(model.mappings.map((m) => [m.answerId, m]));
  const respondents = new Set(model.answers.map((a) => a.respondent)).size;
  const unmapped = model.answers.filter((a) => !mapped.has(a.id)).length;
  return (
    <Section id="human" kicker="Human check" title="Do real people read it the same way?">
      {model.questions.length === 0 ? <Empty>Questions are generated after the findings.</Empty> : (
        <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
          <Card className="p-6">
            <div className="flex items-center gap-2 text-sm font-semibold text-stone-900"><Smartphone size={16} /> Ask people at the venue</div>
            <p className="mt-2 text-sm text-stone-600">They read the original text on their phone and answer three neutral questions. Answers are coded on the same frozen codebook as the personas.</p>
            <a href={url} className="mt-3 block rounded-xl bg-stone-100 px-3 py-2 font-mono text-sm break-all text-indigo-700">{url}</a>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <Badge tone="info">{respondents} respondents</Badge>
              <Badge>{model.answers.length} answers</Badge>
              {unmapped > 0 && (
                <Button
                  kind="subtle"
                  disabled={mapping === "busy"}
                  onClick={() => {
                    setMapping("busy");
                    api.mapAnswers(model.runId).then(() => setMapping("sent"), (err: unknown) => setMapping(String(err)));
                  }}
                >
                  Code {unmapped} new answers
                </Button>
              )}
              {mapping === "sent" && <span className="text-stone-500">coding… results appear here</span>}
              {mapping !== "idle" && mapping !== "busy" && mapping !== "sent" && <span className="text-rose-700">{mapping}</span>}
            </div>
          </Card>
          <div className="space-y-3">
            {model.questions.map((q) => {
              const answers = model.answers.filter((a) => a.questionId === q.id);
              return (
                <Card key={q.id} className="p-5">
                  <div className="font-medium text-stone-900">{q.questionVi}</div>
                  <div className="mt-1 text-xs text-stone-500">probes: {q.findingIds.map((id) => titles.get(id) ?? id).join("; ")}</div>
                  {answers.length > 0 && (
                    <ul className="mt-3 space-y-2 text-sm">
                      {answers.map((a) => {
                        const m = mapped.get(a.id);
                        return (
                          <li key={a.id} className="rounded-lg bg-stone-50 px-3 py-2">
                            <div className="text-stone-800">“{a.answerVi}” <span className="text-xs text-stone-400">— {a.respondent}</span></div>
                            {m && <div className="mt-1 text-xs">{m.findingId ? <Badge tone="warn">same as: {titles.get(m.findingId) ?? m.findingId}</Badge> : <Badge tone="good">no listed misreading</Badge>}</div>}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </Section>
  );
}
