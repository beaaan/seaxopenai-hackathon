import { Suspense, lazy, useEffect, type ReactNode } from "react";
import { useHash } from "./hooks";
import { Shell } from "./shell";
import { RunsPage } from "./pages/RunsPage";
import { RunPage } from "./pages/RunPage";
import { NewPolicyPage } from "./pages/NewPolicyPage";
import { HumanCheckPage } from "./pages/HumanCheckPage";
import { LandingPage } from "./landing/LandingPage";

// The theatre loads only when it opens.
const TheatrePage = lazy(() => import("./theatre/TheatrePage").then((m) => ({ default: m.TheatrePage })));

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function App(): ReactNode {
  const hash = useHash();
  // Hash routes have no matching document anchors, so reset the previous page's scroll.
  useEffect(() => { window.scrollTo(0, 0); }, [hash]);
  if (hash.startsWith("#/check/")) {
    const runId = decode(hash.slice("#/check/".length));
    return runId === null ? <NotFound /> : <HumanCheckPage key={runId} runId={runId} />;
  }
  if (hash.startsWith("#/live/")) {
    const runId = decode(hash.slice("#/live/".length));
    return runId === null ? <NotFound /> : <Suspense fallback={<div className="theatre-loading">Loading the run</div>}><TheatrePage key={runId} runId={runId} /></Suspense>;
  }
  if (hash.startsWith("#/run/")) {
    const [idPart = "", screen = "overview"] = hash.slice("#/run/".length).split("/");
    const runId = decode(idPart);
    return runId === null ? <NotFound /> : <RunPage key={runId} runId={runId} screen={screen} />;
  }
  if (hash === "#/new") {
    return <Shell runNav={null} home={false} newPolicy crumb={<b>Test a new policy</b>}><NewPolicyPage /></Shell>;
  }
  if (hash === "#/policies") {
    return <Shell runNav={null} home newPolicy={false} crumb={<b>Policies tested</b>}><RunsPage /></Shell>;
  }
  if (hash === "#/" || hash === "#" || hash === "") return <LandingPage />;
  return <NotFound />;
}

function NotFound(): ReactNode {
  return (
    <Shell runNav={null} home={false} newPolicy={false} crumb={<b>Not found</b>}>
      <p>Nothing at this address. <a className="link" href="#/">Back to the start</a></p>
    </Shell>
  );
}
