import { useEffect, useState, type ReactNode } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { api, type HumanCheck } from "../api";

/** Mobile page for people at the venue: read the original text, answer three neutral questions. */
export function HumanCheckPage(props: { runId: string }): ReactNode {
  const [check, setCheck] = useState<HumanCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");

  useEffect(() => {
    api.check(props.runId).then(setCheck, (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, [props.runId]);

  if (error) return <main className="mx-auto max-w-lg px-5 py-10 text-rose-700">{error}</main>;
  if (!check) return <main className="mx-auto flex max-w-lg items-center gap-2 px-5 py-10 text-stone-500"><Loader2 className="animate-spin" size={16} /> Đang tải…</main>;
  if (state === "done") {
    return (
      <main className="mx-auto max-w-lg px-5 py-16 text-center">
        <CheckCircle2 size={48} className="mx-auto text-emerald-600" />
        <h1 className="mt-4 text-2xl font-semibold text-stone-900">Cảm ơn bạn!</h1>
        <p className="mt-2 text-stone-600">Câu trả lời của bạn giúp kiểm tra xem người thật có hiểu giống các nhân vật mô phỏng không.</p>
      </main>
    );
  }
  const filled = check.questions.filter((q) => (answers[q.id] ?? "").trim().length > 0);
  const submit = (): void => {
    setState("busy");
    api.answer(props.runId, name.trim() || "ẩn danh", filled.map((q) => ({ questionId: q.id, answerVi: (answers[q.id] ?? "").trim() }))).then(
      () => setState("done"),
      (err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setState("idle");
      },
    );
  };
  return (
    <main className="mx-auto max-w-lg px-5 pt-6 pb-20">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">Bạn hiểu chính sách này thế nào?</h1>
      <p className="mt-2 text-stone-600">Đọc đoạn dưới đây như bạn vẫn đọc trên ứng dụng, rồi trả lời theo cách hiểu của bạn. Không có đáp án đúng sai.</p>
      <div className="mt-5 space-y-4 rounded-2xl border border-stone-200 bg-white p-4 text-[15px] leading-relaxed text-stone-800">
        {check.policy.surfaces.map((s) => (
          <div key={s.id}>
            <div className="mb-1 text-xs font-semibold tracking-wide text-stone-400 uppercase">{s.label}</div>
            <div className="whitespace-pre-line">{s.text}</div>
          </div>
        ))}
      </div>
      <label className="mt-6 block">
        <span className="text-sm font-semibold text-stone-900">Tên (không bắt buộc)</span>
        <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-base" />
      </label>
      {check.questions.map((q, i) => (
        <label key={q.id} className="mt-5 block">
          <span className="font-medium text-stone-900">{i + 1}. {q.questionVi}</span>
          <textarea
            value={answers[q.id] ?? ""}
            onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
            rows={3}
            className="mt-2 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-base"
          />
        </label>
      ))}
      <button
        disabled={filled.length === 0 || state === "busy"}
        onClick={submit}
        className="mt-6 w-full rounded-xl bg-stone-900 py-3 text-base font-semibold text-white disabled:opacity-40"
      >
        {state === "busy" ? "Đang gửi…" : "Gửi câu trả lời"}
      </button>
    </main>
  );
}
