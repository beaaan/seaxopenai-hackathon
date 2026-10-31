import { useState, type ReactNode } from "react";
import { Loader2, Play } from "lucide-react";
import { api } from "../api";
import { Button, Card } from "../ui";

export function NewPolicyPage(): ReactNode {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.createPolicy(title.trim(), text.trim());
      const { runId } = await api.startRun(id, "explore", 24);
      window.location.hash = `#/run/${encodeURIComponent(runId)}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      <h1 className="text-4xl font-semibold tracking-tight text-stone-900">Test a policy</h1>
      <p className="mt-3 text-lg text-stone-600">
        Paste the exact Vietnamese text people will see. Pairwise-sampled readers will read it; you watch the misreadings form live.
        Exploration only (about 24 readers, a few minutes); the full loop with rewrites runs from the CLI.
      </p>
      <Card className="mt-8 p-6">
        <label className="block">
          <span className="text-sm font-semibold text-stone-900">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Chính sách đổi trả 7 ngày"
            className="mt-1 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 focus:border-indigo-400 focus:bg-white focus:outline-none"
          />
        </label>
        <label className="mt-5 block">
          <span className="text-sm font-semibold text-stone-900">Policy text (Vietnamese)</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={14}
            placeholder="Dán nguyên văn nội dung chính sách…"
            className="mt-1 w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 leading-relaxed focus:border-indigo-400 focus:bg-white focus:outline-none"
          />
        </label>
        <div className="mt-5 flex items-center gap-3">
          <Button disabled={busy || !title.trim() || text.trim().length < 40} onClick={() => void start()}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />} Start wind tunnel
          </Button>
          {error && <span className="text-sm text-rose-700">{error}</span>}
        </div>
      </Card>
    </main>
  );
}
