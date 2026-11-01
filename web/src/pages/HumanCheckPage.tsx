import { useEffect, useState, type ReactNode } from "react";
import { CircleCheck, Loader2 } from "lucide-react";
import { humanRespondentId } from "@shared/human";
import { api, type HumanCheck } from "../api";
import { Mark } from "../shell";
import { errorText } from "../ui";

function identity(runId: string, renew = false): string {
  try { return humanRespondentId(runId, window.localStorage, renew); }
  catch { return humanRespondentId(runId, null, renew); }
}

/** Phone page for people at the venue: read the original text, answer three neutral questions. */
export function HumanCheckPage(props: { runId: string }): ReactNode {
  const [check, setCheck] = useState<HumanCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [respondentId, setRespondentId] = useState(() => identity(props.runId));
  const newPerson = (): void => {
    setRespondentId(identity(props.runId, true));
    setName("");
    setAnswers({});
    setError(null);
    setState("idle");
  };

  useEffect(() => {
    api.check(props.runId).then(setCheck, (err: unknown) => setError(errorText(err)));
  }, [props.runId]);

  const header = <div className="brand" style={{ padding: 0, marginBottom: 16 }}><Mark /><span>Policy Wind Tunnel</span></div>;
  if (error && !check) return <main className="phone-page" lang="vi">{header}<p className="notice bad">{error}</p></main>;
  if (!check) return <main className="phone-page" lang="vi">{header}<p className="muted" style={{ display: "flex", gap: 8, alignItems: "center" }}><Loader2 size={16} className="spin" /> Đang tải</p></main>;
  if (state === "done") {
    return (
      <main className="phone-page" lang="vi">
        {header}
        <CircleCheck size={40} className="good" />
        <h1 style={{ marginTop: 12 }}>Cảm ơn bạn!</h1>
        <p className="muted" style={{ marginTop: 8 }}>Câu trả lời của bạn giúp kiểm tra xem người thật có hiểu giống các nhân vật mô phỏng không.</p>
        <div className="stack" style={{ marginTop: 20, gap: 12 }}>
          <button className="btn" onClick={() => setState("idle")}>Sửa câu trả lời của tôi</button>
          <button className="btn" onClick={newPerson}>Người khác trả lời trên thiết bị này</button>
        </div>
      </main>
    );
  }
  const filled = check.questions.filter((q) => (answers[q.id] ?? "").trim().length > 0);
  const submit = (): void => {
    setState("busy");
    setError(null);
    api.answer(props.runId, respondentId, name.trim() || "ẩn danh", filled.map((q) => ({ questionId: q.id, answerVi: (answers[q.id] ?? "").trim() }))).then(
      () => setState("done"),
      (err: unknown) => {
        setError(errorText(err));
        setState("idle");
      },
    );
  };
  return (
    <main className="phone-page" lang="vi">
      {header}
      <h1>Bạn hiểu chính sách này thế nào?</h1>
      {error && <p className="notice bad" role="alert">{error}</p>}
      <p className="muted" style={{ marginTop: 8, fontSize: 15, lineHeight: "22px" }}>Đọc đoạn dưới đây như bạn vẫn đọc trên ứng dụng, rồi trả lời theo cách hiểu của bạn. Không có đáp án đúng sai.</p>
      <button className="btn" style={{ marginTop: 12 }} disabled={state === "busy"} onClick={newPerson}>Người khác trả lời trên thiết bị này</button>
      <div className="panel stack" style={{ marginTop: 16, gap: 14, fontSize: 15, lineHeight: "24px" }}>
        {check.policy.surfaces.map((s) => (
          <div key={s.id}>
            <div className="small muted" style={{ marginBottom: 4 }}>{s.label}</div>
            <div style={{ whiteSpace: "pre-line" }}>{s.text}</div>
          </div>
        ))}
      </div>
      <label className="field" style={{ marginTop: 20 }}>
        <span>Tên (không bắt buộc)</span>
        <input className="input" style={{ minHeight: 44, fontSize: 16 }} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {check.questions.map((q, i) => (
        <label key={q.id} className="field" style={{ marginTop: 18 }}>
          <span style={{ fontSize: 15, lineHeight: "22px" }}>{i + 1}. {q.questionVi}</span>
          <textarea className="input" style={{ fontSize: 16 }} rows={3} value={answers[q.id] ?? ""} onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))} />
        </label>
      ))}
      <button className="btn primary" style={{ width: "100%", height: 48, marginTop: 22, fontSize: 16 }} disabled={filled.length === 0 || state === "busy"} onClick={submit}>
        {state === "busy" ? "Đang gửi" : "Gửi câu trả lời"}
      </button>
    </main>
  );
}
