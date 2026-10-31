import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Bot, FileText, FlaskConical, GitCompareArrows, ListChecks, Play, Smartphone, Square, Target, Users } from "lucide-react";
import { api, type PolicyDetail } from "../api";
import { useReplay, useRun, useRuns } from "../hooks";
import { foldRun, type RunModel } from "../model";
import { Shell, type NavItem } from "../shell";
import { Loading, Empty, cx } from "../ui";
import { Overview } from "../run/Overview";
import { Findings } from "../run/Findings";
import { Rewrite } from "../run/Rewrite";
import { PolicyCI, RetestResult } from "../run/PolicyCI";
import { Readers } from "../run/Readers";
import { Benchmark } from "../run/Benchmark";
import { Reviewer } from "../run/Reviewer";
import { HumanCheck } from "../run/HumanCheck";

export interface RunContext {
  model: RunModel;
  policy: PolicyDetail | null;
}

type ScreenId = "overview" | "findings" | "rewrite" | "ci" | "benchmark" | "readers" | "reviewer" | "human";

const SCREENS: Array<{ id: ScreenId; label: string; icon: ReactNode }> = [
  { id: "overview", label: "Overview", icon: <FileText /> },
  { id: "findings", label: "Findings", icon: <ListChecks /> },
  { id: "rewrite", label: "Rewrite and re-read", icon: <GitCompareArrows /> },
  { id: "ci", label: "Policy CI", icon: <FlaskConical /> },
  { id: "benchmark", label: "Benchmark", icon: <Target /> },
  { id: "readers", label: "Readers", icon: <Users /> },
  { id: "reviewer", label: "Reviewer agent", icon: <Bot /> },
  { id: "human", label: "Human check", icon: <Smartphone /> },
];

function screensFor(model: RunModel | null): ScreenId[] {
  const mode = model?.config?.mode;
  if (mode === "retest") return ["overview", "readers"];
  if (mode === "explore") return ["overview", "readers", "reviewer"];
  return SCREENS.map((s) => s.id);
}

export function RunPage(props: { runId: string; screen: string }): ReactNode {
  const loaded = useRun(props.runId);
  const replay = useReplay(loaded.events.length);
  const model = useMemo(
    () => (replay.shown === null ? loaded.model : foldRun(props.runId, loaded.events.slice(0, replay.shown))),
    [replay.shown, loaded, props.runId],
  );
  const [policy, setPolicy] = useState<PolicyDetail | null>(null);
  const policyId = model?.config?.policyId ?? null;
  useEffect(() => {
    if (policyId === null) return;
    let alive = true;
    api.policy(policyId).then((detail) => alive && setPolicy(detail), () => {});
    return () => {
      alive = false;
    };
  }, [policyId]);

  const available = screensFor(model);
  const screen: ScreenId = available.find((s) => s === props.screen) ?? "overview";
  const isRetest = model?.config?.mode === "retest";
  const base = `#/run/${encodeURIComponent(props.runId)}`;
  const items: NavItem[] = SCREENS.filter((s) => available.includes(s.id)).map((s) => ({
    href: s.id === "overview" ? base : `${base}/${s.id}`,
    label: isRetest && s.id === "overview" ? "Test result" : s.label,
    icon: s.icon,
    current: s.id === screen,
    count: s.id === "findings" && model && model.findings.length > 0 ? model.findings.length : undefined,
  }));

  const p = model?.provenance;
  const footer = p && (p.decisions || p.backends) ? (
    <>
      {p.decisions && <div>Decisions API: {p.decisions}</div>}
      {p.embeddings !== null && <div>Embeddings: {p.embeddings ? "on" : "off"}</div>}
      {p.backends && <div>{p.backends}</div>}
    </>
  ) : undefined;

  const finished = loaded.model?.status === "completed";
  const status = model?.status ?? "running";
  const topRight = (
    <>
      <span className={cx("live", status === "running" && "running", status === "failed" && "failed")}>
        {replay.shown !== null ? `Replaying ${replay.shown}/${loaded.events.length}` : status === "running" ? `Running · ${model?.events ?? 0} events` : status === "failed" ? "Failed" : `Completed · ${model?.events ?? 0} events`}
      </span>
      {finished && (replay.shown !== null
        ? <button className="btn" onClick={replay.stop}><Square /> Stop</button>
        : <button className="btn hide-phone" onClick={replay.start} title="Replay the run's log from the first event"><Play /> Replay</button>)}
    </>
  );

  const crumb = (
    <>
      <span className="hide-phone">{policy?.package.title ?? policyId ?? "Run"}</span>
      <span className="hide-phone" aria-hidden>/</span>
      <RunSwitcher runId={props.runId} policyId={policyId} />
    </>
  );

  let body: ReactNode;
  if (loaded.error) body = <Empty>Could not load {props.runId}: {loaded.error}</Empty>;
  else if (model === null) body = <Loading>Loading {props.runId}</Loading>;
  else {
    const ctx: RunContext = { model, policy };
    body = (
      <>
        {model.error && <div className="notice bad">{model.error}</div>}
        {screen === "overview" && (isRetest ? <RetestResult ctx={ctx} /> : <Overview ctx={ctx} />)}
        {screen === "findings" && <Findings ctx={ctx} />}
        {screen === "rewrite" && <Rewrite ctx={ctx} />}
        {screen === "ci" && <PolicyCI ctx={ctx} />}
        {screen === "benchmark" && <Benchmark ctx={ctx} />}
        {screen === "readers" && <Readers ctx={ctx} />}
        {screen === "reviewer" && <Reviewer ctx={ctx} />}
        {screen === "human" && <HumanCheck ctx={ctx} />}
      </>
    );
  }

  return (
    <Shell runNav={{ label: isRetest ? "Edit test" : "This run", items }} home={false} newPolicy={false} crumb={crumb} topRight={topRight} footer={footer}>
      {body}
    </Shell>
  );
}

/** The scope switcher: every run of this policy, re-tests included. */
function RunSwitcher(props: { runId: string; policyId: string | null }): ReactNode {
  const runs = useRuns(5000);
  const options = (runs ?? []).filter((r) => r.runId === props.runId || (props.policyId !== null && r.policyId === props.policyId));
  if (options.length <= 1) return <b className="id" style={{ color: "var(--text)" }}>{props.runId}</b>;
  const sorted = [...options].sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
  return (
    <select className="scope" aria-label="Run" value={props.runId} onChange={(e) => { window.location.hash = `#/run/${encodeURIComponent(e.target.value)}`; }}>
      {sorted.map((r) => <option key={r.runId} value={r.runId}>{r.runId}</option>)}
    </select>
  );
}
