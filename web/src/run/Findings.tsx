import { useMemo, type ReactNode } from "react";
import { ArrowDown, Check, CircleHelp, Scale, Wrench, X } from "lucide-react";
import type { Finding, Iteration } from "@shared/schema";
import { CLASS_LABEL, finalVersion } from "../model";
import type { RunContext } from "../pages/RunPage";
import { Badge, Card, Empty, Meter, Section, cx, pct, pp, type Tone } from "../ui";

const CLASS_TONE: Record<Finding["class"], Tone> = { wording_fix: "good", design_gap: "warn", unresolvable: "bad" };
const CLASS_ICON: Record<Finding["class"], ReactNode> = { wording_fix: <Wrench size={12} />, design_gap: <Scale size={12} />, unresolvable: <CircleHelp size={12} /> };
const ORDER: Record<Finding["class"], number> = { wording_fix: 0, design_gap: 1, unresolvable: 2 };

export function Findings(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const first = model.iterations[0] ?? null;
  const last = model.iterations.findLast((it) => it.policyVersion === finalVersion(model)) ?? null;
  const sorted = useMemo(() => {
    const rate = (f: Finding): number => first?.findingReproduction.find((r) => r.findingId === f.id)?.rate ?? 0;
    return [...model.findings].sort((a, b) => ORDER[a.class] - ORDER[b.class] || rate(b) - rate(a));
  }, [model.findings, first]);
  const sentences = new Map(model.versions.find((v) => v.version === 0)?.sentences.map((s) => [s.id, s.text]) ?? []);
  const mapped = new Map<string, number>();
  for (const m of model.mappings) if (m.findingId) mapped.set(m.findingId, (mapped.get(m.findingId) ?? 0) + 1);

  return (
    <Section id="findings" kicker="Findings" title="What readers get wrong, and whether wording can fix it">
      <p className="mb-6 max-w-3xl text-stone-600">
        Every finding is classified by <b>attempting</b> a repair: if a rewrite that adds no new facts passes the fidelity check and the
        misreading disappears when re-read, it is a wording fix. Otherwise the text needs a rule change or information it does not have.
      </p>
      {sorted.length === 0 ? <Empty>No findings yet.</Empty> : (
        <div className="space-y-4">
          {sorted.map((finding) => (
            <FindingCard key={finding.id} finding={finding} first={first} last={last !== first ? last : null} sentences={sentences} humans={mapped.get(finding.id) ?? 0} />
          ))}
        </div>
      )}
    </Section>
  );
}

function FindingCard(props: { finding: Finding; first: Iteration | null; last: Iteration | null; sentences: Map<string, string>; humans: number }): ReactNode {
  const { finding: f } = props;
  const before = props.first?.findingReproduction.find((r) => r.findingId === f.id) ?? null;
  const after = props.last?.findingReproduction.find((r) => r.findingId === f.id) ?? null;
  const provisional = f.classRationale.startsWith("Provisional");
  const repair = f.repair;
  return (
    <Card className="overflow-hidden">
      <div className="grid gap-6 p-6 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={CLASS_TONE[f.class]}>{CLASS_ICON[f.class]} {CLASS_LABEL[f.class]}</Badge>
            {provisional && <Badge tone="neutral" title={f.classRationale}>provisional</Badge>}
            {f.conflictsReference && <Badge tone="bad">contradicts the reference</Badge>}
            {props.humans > 0 && <Badge tone="info">{props.humans} real {props.humans === 1 ? "person" : "people"} gave this reading</Badge>}
            <span className="font-mono text-xs text-stone-400">{f.id}</span>
          </div>
          <h3 className="mt-3 text-xl font-semibold tracking-tight text-stone-900">{f.title}</h3>
          <p className="mt-2 text-stone-700">{f.readingSummary}</p>
          {f.plausibility && <p className="mt-2 text-sm text-stone-500">Why a real reader would: {f.plausibility}</p>}
          {f.sentenceIds.length > 0 ? (
            <div className="mt-4 space-y-1">
              {f.sentenceIds.map((id) => (
                <div key={id} className="flex gap-3 rounded-lg bg-orange-50 px-3 py-2 text-sm">
                  <span className="w-16 shrink-0 font-mono text-[11px] text-orange-700">{id}</span>
                  <span className="text-stone-800">{props.sentences.get(id) ?? ""}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-lg border border-dashed border-rose-300 px-3 py-2 text-sm text-rose-800">About a rule the text never states.</div>
          )}
          {f.dimsAssociated.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">{f.dimsAssociated.map((d) => <Badge key={d}>{d}</Badge>)}</div>
          )}
        </div>
        <div className="space-y-4">
          <div>
            <div className="text-xs font-semibold tracking-wide text-stone-400 uppercase">Readers holding it</div>
            {before && before.n > 0 ? (
              <div className="mt-2 space-y-2">
                <ReproRow label="Original" rate={before.rate} n={before.n} band={before.noiseBand} />
                {after && after.n > 0 && <ReproRow label={`v${props.last?.policyVersion}`} rate={after.rate} n={after.n} band={before.noiseBand} compare={before.rate} />}
              </div>
            ) : <div className="mt-2 text-sm text-stone-500">Measured once the codebook is frozen.</div>}
            <div className="mt-1 text-xs text-stone-400">{f.evidence.readingIds.length} supporting readings · {f.evidence.clusterIds.length} beliefs</div>
          </div>
          <div className="text-sm text-stone-600">{f.classRationale}</div>
        </div>
      </div>
      {repair && (repair.rewriteVi || repair.fidelity.requiresNewFact) && (
        <div className="border-t border-stone-100 bg-stone-50/70 px-6 py-5">
          {repair.rewriteVi && (
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="mb-1 text-xs font-semibold tracking-wide text-stone-400 uppercase">Before</div>
                <div className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-stone-800 line-through decoration-rose-300">
                  {repair.targetSentenceIds.map((id) => props.sentences.get(id)).filter(Boolean).join(" ") || "(insertion)"}
                </div>
              </div>
              <div>
                <div className="mb-1 text-xs font-semibold tracking-wide text-stone-400 uppercase">Attempted repair</div>
                <div className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-stone-900">{repair.rewriteVi}</div>
              </div>
            </div>
          )}
          {repair.rewriteVi && (
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <Badge tone={repair.fidelity.passed ? "good" : "bad"}>{repair.fidelity.passed ? <Check size={12} /> : <X size={12} />} fidelity {repair.fidelity.passed ? "passed" : "failed"}</Badge>
              {repair.fidelity.facts.map((fact) => (
                <Badge key={fact.factId} tone={fact.entailed ? "neutral" : "bad"} title={fact.why}>{fact.entailed ? <Check size={12} /> : <X size={12} />} {fact.factId}</Badge>
              ))}
              {repair.fidelity.newCommitments.map((c, i) => <Badge key={i} tone="bad" title={c}>new commitment</Badge>)}
            </div>
          )}
          {repair.fidelity.requiresNewFact && (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-semibold">{repair.fidelity.requiresNewFact.kind === "changes_rule" ? "Needs a rule change: " : "Needs information the text does not have: "}</span>
              {repair.fidelity.requiresNewFact.text}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ReproRow(props: { label: string; rate: number; n: number; band: number | null; compare?: number }): ReactNode {
  const delta = props.compare === undefined ? null : props.rate - props.compare;
  const beyond = delta !== null && props.band !== null && Math.abs(delta) > props.band;
  return (
    <div className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 text-sm">
      <span className="text-stone-500">{props.label}</span>
      <Meter value={props.rate} band={props.band} tone={delta !== null && beyond ? (delta < 0 ? "good" : "bad") : undefined} />
      <span className="w-40 text-right tabular-nums text-stone-700">
        {pct(props.rate)} <span className="text-stone-400">n={props.n}</span>
        {delta !== null && (
          <span className={cx("ml-2", beyond ? (delta < 0 ? "text-emerald-700" : "text-rose-700") : "text-stone-400")}>
            {delta < 0 && <ArrowDown size={12} className="inline" />}{pp(delta)}
          </span>
        )}
        {delta === null && props.band !== null && <span className="ml-2 text-stone-400">±{(props.band * 100).toFixed(0)}</span>}
      </span>
    </div>
  );
}
