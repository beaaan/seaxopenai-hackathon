import type { ReactNode } from "react";
import { useHash } from "./hooks";
import { Shell } from "./shell";
import { RunsPage } from "./pages/RunsPage";
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
  if (hash.startsWith("#/run/")) {
    const [idPart = "", screen = "overview"] = hash.slice("#/run/".length).split("/");
    const runId = decode(idPart);
    return runId === null ? <NotFound /> : <RunPage key={runId} runId={runId} screen={screen} />;
  }
  if (hash === "#/new") {
    return <Shell runNav={null} home={false} newPolicy crumb={<b>Test a new policy</b>}><NewPolicyPage /></Shell>;
  }
  return <Shell runNav={null} home newPolicy={false} crumb={<b>All runs</b>}><RunsPage /></Shell>;
}

function NotFound(): ReactNode {
  return (
    <Shell runNav={null} home={false} newPolicy={false} crumb={<b>Not found</b>}>
      <p>Nothing at this address. <a className="link" href="#/">All runs</a></p>
    </Shell>
  );
}
