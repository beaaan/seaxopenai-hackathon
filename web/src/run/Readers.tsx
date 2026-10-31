import { useMemo, useState, type ReactNode } from "react";
import { Eye, EyeOff, MessageCircleQuestion, Users } from "lucide-react";
import type { Grade, Reading, Scenario } from "@shared/schema";
import { originalReadings } from "../model";
import type { RunContext } from "../pages/RunPage";
import { Badge, Card, Empty, Section, cx, type Tone } from "../ui";

const GRADE_TONE: Record<Grade["label"], Tone> = { consistent: "good", conflicts: "bad", outside: "warn", unclear: "neutral" };

export function Readers(props: { ctx: RunContext }): ReactNode {
  const { model, policy } = props.ctx;
  const version = model.config?.mode === "retest" ? (model.versions.at(-1)?.version ?? 0) : 0;
  const readings = useMemo(() => new Map(originalReadings(model, version).map((r) => [r.scenarioId, r])), [model, version]);
  const grades = useMemo(() => new Map(model.grades.map((g) => [g.interpretationId, g])), [model.grades]);
  const [filter, setFilter] = useState<{ dimId: string; levelId: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const surfaceLabel = new Map(model.versions[0]?.surfaces.map((s) => [s.id, s.label]) ?? []);
  const folk = new Map(policy?.folk.versions.map((f) => [f.id, f]) ?? []);
  const shown = model.scenarios.filter((s) => filter === null || s.levels.some((l) => l.dimId === filter.dimId && l.levelId === filter.levelId));

  return (
    <Section id="readers" kicker="Readers" title={`${model.scenarios.length} simulated readers`} aside={<span className="flex items-center gap-1 text-sm text-stone-500"><Users size={16} /> pairwise coverage of every dimension</span>}>
      {model.dimensions.length > 0 && (
        <div className="mb-6 space-y-2">
          {model.dimensions.map((dim) => (
            <div key={dim.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="w-56 shrink-0 truncate text-stone-500" title={dim.description}>{dim.name}</span>
              {dim.levels.map((level) => {
                const count = model.scenarios.filter((s) => s.levels.some((l) => l.dimId === dim.id && l.levelId === level.id)).length;
                const active = filter?.dimId === dim.id && filter.levelId === level.id;
                return (
                  <button
                    key={level.id}
                    title={level.description}
                    onClick={() => setFilter(active ? null : { dimId: dim.id, levelId: level.id })}
                    className={cx("rounded-full px-3 py-1 text-xs ring-1 ring-inset", active ? "bg-stone-900 text-white ring-stone-900" : "bg-white text-stone-700 ring-stone-200 hover:ring-stone-400")}
                  >
                    <span className="inline-block max-w-[22rem] truncate align-bottom">{level.label}</span> <span className={active ? "text-stone-300" : "text-stone-400"}>{count}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {shown.length === 0 ? <Empty>No readers yet.</Empty> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((scenario) => (
            <ReaderCard
              key={scenario.id}
              scenario={scenario}
              reading={readings.get(scenario.id) ?? null}
              grades={grades}
              open={open === scenario.id}
              onToggle={() => setOpen(open === scenario.id ? null : scenario.id)}
              surfaceLabel={(id) => surfaceLabel.get(id) ?? id}
              folkText={(id) => folk.get(id)?.textVi ?? id}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function ReaderCard(props: {
  scenario: Scenario; reading: Reading | null; grades: Map<string, Grade>; open: boolean; onToggle: () => void;
  surfaceLabel: (id: string) => string; folkText: (id: string) => string;
}): ReactNode {
  const { scenario: s, reading: r } = props;
  const p = s.persona;
  return (
    <Card className={cx("p-4", props.open && "md:col-span-2 xl:col-span-3")} onClick={props.onToggle} active={props.open}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-stone-900">{p.name}, {p.age}</div>
          <div className="text-sm text-stone-500">{p.occupation} · {p.province}</div>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          <Badge tone={s.exposure.attention === "skim" ? "warn" : "neutral"}>{s.exposure.attention === "skim" ? <EyeOff size={11} /> : <Eye size={11} />}{s.exposure.attention}</Badge>
          {s.origin === "adaptive" && <Badge tone="accent" title={s.allocationReason ?? undefined}>targeted</Badge>}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-1 text-xs">
        {s.exposure.surfaceIds.map((id) => <Badge key={id}>read: {props.surfaceLabel(id)}</Badge>)}
        {s.exposure.folkVersionId && <Badge tone="warn" title={props.folkText(s.exposure.folkVersionId)}>heard a rumour</Badge>}
      </div>
      {r ? (
        <>
          <p className="mt-3 text-sm leading-relaxed text-stone-800">“{r.paraphraseVi}”</p>
          {!props.open && r.questions.length > 0 && <div className="mt-2 flex items-center gap-1 text-xs text-stone-500"><MessageCircleQuestion size={12} /> {r.questions.length} open question{r.questions.length > 1 ? "s" : ""}</div>}
        </>
      ) : <p className="mt-3 text-sm text-stone-400">Reading…</p>}
      {props.open && r && (
        <div className="mt-4 grid gap-6 border-t border-stone-100 pt-4 lg:grid-cols-2" onClick={(e) => e.stopPropagation()}>
          <div>
            <div className="text-xs font-semibold tracking-wide text-stone-400 uppercase">Situation</div>
            <p className="mt-1 text-sm text-stone-700">{s.situationVi}</p>
            {s.exposure.folkVersionId && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Heard: “{props.folkText(s.exposure.folkVersionId)}”</p>}
            <div className="mt-3 text-xs font-semibold tracking-wide text-stone-400 uppercase">Would do</div>
            <ul className="mt-1 space-y-1 text-sm text-stone-700">{r.actions.map((a, i) => <li key={i}><Badge>{a.action}</Badge> {a.detailVi}</li>)}</ul>
            <div className="mt-3 text-xs font-semibold tracking-wide text-stone-400 uppercase">Feels</div>
            <p className="mt-1 text-sm text-stone-700">{r.feelingVi}</p>
          </div>
          <div>
            <div className="text-xs font-semibold tracking-wide text-stone-400 uppercase">Interpretations</div>
            <ul className="mt-2 space-y-3">
              {r.interpretations.map((i) => {
                const g = props.grades.get(i.id);
                return (
                  <li key={i.id} className="text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-stone-400">{i.sentenceId ?? "not in text"}</span>
                      {g && g.label !== "unclear" && <Badge tone={GRADE_TONE[g.label]}>{g.label}</Badge>}
                    </div>
                    <div className="mt-0.5 text-stone-800">{i.meaningVi}</div>
                    <div className="text-xs text-stone-500">{i.glossEn}</div>
                  </li>
                );
              })}
            </ul>
            {r.questions.length > 0 && (
              <>
                <div className="mt-4 text-xs font-semibold tracking-wide text-stone-400 uppercase">Still asks</div>
                <ul className="mt-1 space-y-1 text-sm text-stone-700">{r.questions.map((q) => <li key={q.id}>{q.questionVi} <span className="text-xs text-stone-500">({q.glossEn})</span></li>)}</ul>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
