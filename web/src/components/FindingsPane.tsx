import type { ReactNode } from "react";
import type { Cluster, FidelityResult, Finding } from "@shared/schema";
import { findCluster, type RunView } from "../state";
import { Badge, FINDING_CLASS_META, pct, SectionTitle } from "../ui";
import { NOT_IN_TEXT } from "./PolicyPane";

const SAMPLE_INTERPRETATIONS = 3;

function onSentence(sentenceId: string | null, filter: string): boolean {
  return filter === NOT_IN_TEXT ? sentenceId === null : sentenceId === filter;
}

function findingTouches(view: RunView, finding: Finding, filter: string): boolean {
  if (filter !== NOT_IN_TEXT && finding.sentenceIds.includes(filter)) return true;
  return finding.evidence.clusterIds.some((id) => {
    const c = findCluster(view, id);
    return c !== null && onSentence(c.sentenceId, filter);
  });
}

function sentenceText(view: RunView, id: string): string {
  for (const v of Object.values(view.versions)) {
    const s = v.sentences.find((x) => x.id === id);
    if (s !== undefined) return s.text;
  }
  return "(unknown sentence)";
}

function ClusterCard(props: { view: RunView; cluster: Cluster; samples: number }): ReactNode {
  const { view, cluster } = props;
  const conflict = cluster.conflictShare;
  return (
    <div className="rounded border border-slate-200 p-2">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="font-semibold">{cluster.labelVi}</div>
          <div className="text-sm text-slate-500">{cluster.labelEn}</div>
        </div>
        <div className="shrink-0 text-right font-mono text-xs">
          <div>{cluster.sentenceId ?? "not in text"}</div>
          <div>
            {cluster.interpretationIds.length} interp · <span className={conflict > 0.5 ? "text-red-700" : "text-slate-600"}>{pct(conflict)} conflict</span>
          </div>
        </div>
      </div>
      {props.samples > 0 && (
        <ul className="mt-2 space-y-1">
          {cluster.interpretationIds.slice(0, props.samples).map((id) => {
            const ref = view.interpretations[id];
            if (ref === undefined) return null;
            const persona = view.scenarios[ref.scenarioId]?.persona.name ?? ref.scenarioId;
            const grade = view.grades[id];
            return (
              <li key={id} className="rounded bg-slate-50 p-2 text-sm">
                <div>“{ref.interpretation.meaningVi}”</div>
                <div className="text-slate-500 italic">{ref.interpretation.glossEn}</div>
                <div className="mt-1 text-xs text-slate-500">
                  — {persona} · conf {ref.interpretation.confidence.toFixed(2)}
                  {grade !== undefined && <> · graded {grade.label}</>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Fidelity(props: { fidelity: FidelityResult }): ReactNode {
  const f = props.fidelity;
  return (
    <div className="space-y-2 text-sm">
      <Badge className={f.passed ? "bg-emerald-100 text-emerald-800 ring-emerald-300" : "bg-red-100 text-red-800 ring-red-300"}>
        fidelity {f.passed ? "passed" : "failed"}
      </Badge>
      {f.facts.length > 0 && (
        <table className="w-full">
          <tbody>
            {f.facts.map((c) => (
              <tr key={c.factId} className="border-t border-slate-100 align-top">
                <td className="w-12 py-1 font-mono">{c.factId}</td>
                <td className="w-6">{c.entailed ? "✔" : "✖"}</td>
                <td className="text-slate-600">{c.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {f.newCommitments.length > 0 && (
        <div>
          <div className="font-semibold text-red-800">New commitments</div>
          <ul className="list-disc pl-5">
            {f.newCommitments.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      {f.requiresNewFact !== null && (
        <div className="rounded bg-amber-50 p-2 ring-1 ring-amber-200">
          <span className="font-semibold">Requires new fact ({f.requiresNewFact.kind === "changes_rule" ? "changes the rule" : "missing information"}):</span>{" "}
          {f.requiresNewFact.text}
        </div>
      )}
    </div>
  );
}

function FindingDetail(props: { view: RunView; finding: Finding; onClose: () => void }): ReactNode {
  const { view, finding } = props;
  const meta = FINDING_CLASS_META[finding.class];
  const clusters = finding.evidence.clusterIds.map((id) => findCluster(view, id)).filter((c): c is Cluster => c !== null);
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" data-testid="finding-detail">
      <button type="button" onClick={props.onClose} className="text-sm font-semibold text-indigo-700 hover:underline">
        ← all findings
      </button>
      <div>
        <div className="flex items-center gap-2">
          <Badge className={meta.className}>{meta.label}</Badge>
          <span className="font-mono text-xs text-slate-400">{finding.id}</span>
          {finding.conflictsReference && <Badge className="bg-red-100 text-red-800 ring-red-300">conflicts reference</Badge>}
        </div>
        <h3 className="mt-1 text-lg font-bold">{finding.title}</h3>
      </div>
      <div className="space-y-1">
        {finding.sentenceIds.map((id) => (
          <blockquote key={id} className="border-l-4 border-indigo-300 bg-indigo-50 px-2 py-1 text-sm">
            <span className="mr-2 font-mono text-xs text-slate-400">{id}</span>
            {sentenceText(view, id)}
          </blockquote>
        ))}
      </div>
      <div>
        <div className="text-xs font-bold text-slate-500 uppercase">How it is read</div>
        <p>{finding.readingSummary}</p>
      </div>
      <div>
        <div className="text-xs font-bold text-slate-500 uppercase">Plausibility</div>
        <p>{finding.plausibility}</p>
      </div>
      <div>
        <div className="text-xs font-bold text-slate-500 uppercase">Classification</div>
        <p>{finding.classRationale}</p>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        <span className="text-slate-500">Facts:</span>
        {finding.factIds.length === 0 ? <span className="text-slate-400">none</span> : finding.factIds.map((id) => <Badge key={id} className="bg-sky-50 text-sky-800 ring-sky-200">{id}</Badge>)}
        <span className="ml-3 text-slate-500">Dims:</span>
        {finding.dimsAssociated.map((id) => (
          <Badge key={id} className="bg-violet-50 text-violet-800 ring-violet-200">
            {view.dimensions.find((d) => d.id === id)?.name ?? id}
          </Badge>
        ))}
      </div>
      <div className="space-y-2">
        <div className="text-xs font-bold text-slate-500 uppercase">
          Clusters ({finding.evidence.readingIds.length} readings, {finding.evidence.scenarioIds.length} scenarios)
        </div>
        {clusters.map((c) => (
          <ClusterCard key={c.id} view={view} cluster={c} samples={SAMPLE_INTERPRETATIONS} />
        ))}
      </div>
      {finding.repair !== null && (
        <div className="space-y-2 rounded border border-slate-200 p-2">
          <div className="text-xs font-bold text-slate-500 uppercase">Repair attempt ({finding.repair.targetSentenceIds.join(", ")})</div>
          <p className="rounded bg-emerald-50 p-2">{finding.repair.rewriteVi}</p>
          <Fidelity fidelity={finding.repair.fidelity} />
        </div>
      )}
    </div>
  );
}

export function FindingsPane(props: {
  view: RunView;
  version: number | null;
  sentenceFilter: string | null;
  selectedFindingId: string | null;
  onSelectFinding: (id: string | null) => void;
  onClearFilter: () => void;
}): ReactNode {
  const { view, sentenceFilter } = props;
  const selected = view.findings.find((f) => f.id === props.selectedFindingId);
  const findings = sentenceFilter === null ? view.findings : view.findings.filter((f) => findingTouches(view, f, sentenceFilter));
  const versionClusters = props.version === null ? [] : (view.clusters[props.version] ?? []);
  const clusters = sentenceFilter === null ? versionClusters : versionClusters.filter((c) => onSentence(c.sentenceId, sentenceFilter));

  return (
    <section className="flex min-h-0 flex-col rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <SectionTitle
        right={
          sentenceFilter !== null && (
            <button type="button" onClick={props.onClearFilter} className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-semibold text-indigo-800">
              {sentenceFilter === NOT_IN_TEXT ? "not in text" : sentenceFilter} ✕
            </button>
          )
        }
      >
        Findings
      </SectionTitle>
      {selected !== undefined ? (
        <FindingDetail view={view} finding={selected} onClose={() => props.onSelectFinding(null)} />
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {findings.length === 0 && <p className="text-slate-500">No findings{sentenceFilter === null ? " yet" : " on this sentence"}.</p>}
          <ul className="space-y-2">
            {findings.map((f) => {
              const meta = FINDING_CLASS_META[f.class];
              return (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => props.onSelectFinding(f.id)}
                    className="w-full rounded border border-slate-200 p-2 text-left hover:border-indigo-400 hover:bg-indigo-50"
                  >
                    <div className="flex items-center gap-2">
                      <Badge className={meta.className}>{meta.label}</Badge>
                      <span className="font-mono text-xs text-slate-400">{f.sentenceIds.join(", ") || "not in text"}</span>
                    </div>
                    <div className="mt-1 font-semibold">{f.title}</div>
                  </button>
                </li>
              );
            })}
          </ul>
          {clusters.length > 0 && (
            <div className="space-y-2">
              <div className="text-xs font-bold text-slate-500 uppercase">Clusters on v{props.version}</div>
              {clusters.map((c) => (
                <ClusterCard key={c.id} view={view} cluster={c} samples={sentenceFilter === null ? 0 : 2} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
