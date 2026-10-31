import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createPolicy, fetchHumanCheck, startRun, submitHumanAnswers, type HumanCheck } from "../api";

export function HumanCheckPage(props: { runId: string }): ReactNode {
  const [check, setCheck] = useState<HumanCheck | null>(null);
  const [respondent, setRespondent] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchHumanCheck(props.runId).then((value) => { if (!cancelled) setCheck(value); }, (err: unknown) => { if (!cancelled) setError(String(err)); });
    return () => { cancelled = true; };
  }, [props.runId]);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (check === null) return;
    setBusy(true);
    setError(null);
    try {
      await submitHumanAnswers(props.runId, respondent.trim(), check.questions.map((question) => ({ questionId: question.id, answerVi: (answers[question.id] ?? "").trim() })));
      setSent(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };
  return <main lang="vi" className="mx-auto min-h-screen max-w-2xl px-4 py-6 sm:px-8 sm:py-10">
    <a href="#/" className="font-semibold text-indigo-800">← Policy Wind Tunnel</a>
    {sent ? <section className="mt-8 rounded-xl border border-emerald-300 bg-white p-6 shadow-sm" role="status"><h1 className="text-3xl font-bold text-emerald-900">Cảm ơn bạn!</h1><p className="mt-4 text-lg">Câu trả lời của bạn đã được ghi nhận. Bạn có thể đóng trang này.</p></section> : <>
      <h1 className="mt-6 text-3xl font-bold">Bạn hiểu chính sách này thế nào?</h1><p className="mt-3 text-lg text-slate-700">Đọc nội dung bên dưới rồi trả lời bằng lời của bạn. Không cần tra cứu hay đoán “đáp án đúng”.</p>
      {check === null && error === null && <p className="mt-6" role="status">Đang tải nội dung…</p>}
      {check !== null && <>
        <section className="mt-6 space-y-5 rounded-xl border border-slate-200 bg-white p-5"><h2 className="text-xl font-bold">Chính sách gốc · phiên bản v0</h2>{check.policy.surfaces.map((surface) => <div key={surface.id}><h3 className="font-bold text-slate-600">{surface.label}</h3><p className="mt-2 whitespace-pre-wrap leading-relaxed">{surface.text}</p></div>)}</section>
        {check.questions.length === 0 ? <p className="mt-6 rounded-lg bg-amber-50 p-4">Chưa có câu hỏi cho lượt chạy này. Vui lòng quay lại sau.</p> : <form className="mt-6 space-y-6" onSubmit={(event) => void submit(event)}>
          <label className="block text-lg font-semibold">Tên của bạn<input name="respondent" autoComplete="name" required disabled={busy} value={respondent} onChange={(event) => setRespondent(event.target.value)} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white p-3 font-normal" /></label>
          {check.questions.map((question, index) => <label key={question.id} className="block text-lg font-semibold">{index + 1}. {question.questionVi}<textarea name={question.id} rows={4} required disabled={busy} value={answers[question.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white p-3 font-normal leading-relaxed" /></label>)}
          <button type="submit" disabled={busy || respondent.trim() === "" || check.questions.some((question) => (answers[question.id] ?? "").trim() === "")} className="w-full rounded-lg bg-indigo-700 px-5 py-4 text-lg font-bold text-white disabled:opacity-50">{busy ? "Đang gửi…" : "Gửi câu trả lời"}</button>
        </form>}
      </>}
      {error !== null && <p role="alert" className="mt-5 rounded-lg border border-red-200 bg-red-50 p-4 text-red-900">Không thể hoàn tất. {error}</p>}
    </>}
  </main>;
}

export function NewPolicyPage(props: { onRun: (runId: string) => void }): ReactNode {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [policyId, setPolicyId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const id = policyId ?? (await createPolicy(title.trim(), text.trim())).id;
      setPolicyId(id);
      const result = await startRun(id);
      props.onRun(result.runId);
    } catch (err) {
      setError(String(err));
      setBusy(false);
    }
  };
  return <main className="mx-auto min-h-screen max-w-3xl px-4 py-8 sm:px-8">
    <a href="#/" className="font-semibold text-indigo-800">← Policy Wind Tunnel</a>
    <h1 className="mt-6 text-3xl font-bold">Test a new policy</h1><p className="mt-3 text-lg text-slate-600">Paste the text people actually see. Explore 16 reader scenarios, then follow the run live.</p>
    <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-5 rounded-xl border border-slate-200 bg-white p-5 sm:p-7">
      <label className="block text-lg font-semibold">Policy title<input required disabled={busy} value={title} onChange={(event) => { setTitle(event.target.value); setPolicyId(null); }} className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-normal" /></label>
      <label className="block text-lg font-semibold">Policy text · tiếng Việt<textarea required rows={14} disabled={busy} value={text} onChange={(event) => { setText(event.target.value); setPolicyId(null); }} className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-normal leading-relaxed" /></label>
      <button type="submit" disabled={busy || title.trim() === "" || text.trim() === ""} className="rounded-lg bg-indigo-700 px-5 py-3 text-lg font-bold text-white disabled:opacity-50">{busy ? "Starting exploration…" : "Explore policy · 16 readers"}</button>
      {error !== null && <p role="alert" className="text-red-800">{error}</p>}
    </form>
  </main>;
}
