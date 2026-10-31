import type { ReactNode } from "react";
import { Wind } from "lucide-react";
import { useHash } from "./hooks";
import { HomePage } from "./pages/HomePage";
import { RunPage } from "./pages/RunPage";
import { NewPolicyPage } from "./pages/NewPolicyPage";
import { HumanCheckPage } from "./pages/HumanCheckPage";

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function App(): ReactNode {
  const hash = useHash();
  if (hash.startsWith("#/check/")) {
    const runId = decode(hash.slice("#/check/".length));
    return runId === null ? <NotFound /> : <HumanCheckPage key={runId} runId={runId} />;
  }
  let page: ReactNode;
  if (hash.startsWith("#/run/")) {
    const runId = decode(hash.slice("#/run/".length));
    page = runId === null ? <NotFound /> : <RunPage key={runId} runId={runId} />;
  } else if (hash === "#/new") {
    page = <NewPolicyPage />;
  } else {
    page = <HomePage />;
  }
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-stone-200/80 bg-[#f7f6f3]/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-6">
          <a href="#/" className="flex items-center gap-2 font-semibold tracking-tight text-stone-900">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-stone-900 text-white"><Wind size={16} /></span>
            Policy Wind Tunnel
          </a>
          <nav className="flex items-center gap-1 text-sm">
            <a href="#/" className="rounded-lg px-3 py-1.5 text-stone-600 hover:bg-stone-200/60 hover:text-stone-900">Runs</a>
            <a href="#/new" className="rounded-lg px-3 py-1.5 text-stone-600 hover:bg-stone-200/60 hover:text-stone-900">Test a policy</a>
          </nav>
        </div>
      </header>
      {page}
    </div>
  );
}

function NotFound(): ReactNode {
  return <main className="mx-auto max-w-3xl px-6 py-16 text-stone-600">Not found. <a className="underline" href="#/">Back to runs</a></main>;
}
