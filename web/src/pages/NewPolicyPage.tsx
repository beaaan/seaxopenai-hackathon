import { useState, type ReactNode } from "react";
import { Loader2, Play } from "lucide-react";
import { api } from "../api";
import { Panel, TitleRow, errorText } from "../ui";

const MIN_TEXT = 40;

export function NewPolicyPage(): ReactNode {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = title.trim().length > 0 && text.trim().length >= MIN_TEXT;
  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createPolicy(title.trim(), text.trim());
      const { runId } = await api.startRun(id, "explore", 24);
      window.location.hash = `#/run/${encodeURIComponent(runId)}`;
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };
  return (
    <>
      <TitleRow title="Test a new policy" sub="Paste the exact Vietnamese text people will see. About 24 simulated readers read it, and the misreadings form on the text as they finish." />
      <div className="grid">
        <div className="c8">
          <Panel title="Policy">
            <div className="stack" style={{ gap: 16 }}>
              <label className="field">
                <span>Title</span>
                <input className="input" lang="vi" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Chính sách đổi trả 7 ngày" />
              </label>
              <label className="field">
                <span>Text, exactly as published</span>
                <textarea className="input" lang="vi" value={text} onChange={(e) => setText(e.target.value)} rows={16} placeholder="Dán nguyên văn nội dung chính sách" />
                <span className="small muted">{text.trim().length < MIN_TEXT ? `At least ${MIN_TEXT} characters` : `${text.trim().length} characters`}</span>
              </label>
            </div>
            <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16 }}>
              <button className="btn primary" disabled={busy || !ready} onClick={() => void start()}>{busy ? <Loader2 className="spin" /> : <Play />} Start reading</button>
              {error && <span className="small bad">{error}</span>}
            </div>
          </Panel>
        </div>
        <div className="c4">
          <Panel title="What this run does">
            <ol className="rows">
              <li className="row" style={{ alignItems: "flex-start" }}><span className="id">1</span><span>Picks reader traits for this text and samples readers so every pair of traits meets.</span></li>
              <li className="row" style={{ alignItems: "flex-start" }}><span className="id">2</span><span>Each reader reads the text in their situation and says what they understood and would do.</span></li>
              <li className="row" style={{ alignItems: "flex-start" }}><span className="id">3</span><span>Beliefs shared by two or more readers are traced to the sentence that caused them.</span></li>
              <li className="row" style={{ alignItems: "flex-start" }}><span className="id">4</span><span>The reviewer agent decides who reads next. The full loop with rewrites runs from the CLI.</span></li>
            </ol>
          </Panel>
        </div>
      </div>
    </>
  );
}
