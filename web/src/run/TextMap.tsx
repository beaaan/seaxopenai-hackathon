import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { MapPin, Quote } from "lucide-react";
import type { Cluster, Interpretation, Reading, Scenario } from "@shared/schema";
import { distinctReaders, finalVersion, hasReference, scenarioById, sentenceHeat } from "../model";
import type { RunContext } from "../pages/RunPage";
import { Badge, Card, Empty, Section, cx, pct } from "../ui";

interface Atom {
  interpretation: Interpretation;
  reading: Reading;
  scenario: Scenario | undefined;
}

const NOT_IN_TEXT = "__not_in_text__";

/** Heat from white to deep orange by share of the hottest sentence. */
function heatStyle(readers: number, max: number): CSSProperties {
  if (readers === 0 || max === 0) return {};
  const t = readers / max;
  return { backgroundColor: `rgba(249, 115, 22, ${0.08 + 0.42 * t})` };
}

export function TextMap(props: { ctx: RunContext }): ReactNode {
  const { model } = props.ctx;
  const heat = useMemo(() => sentenceHeat(model), [model]);
  const scenarios = useMemo(() => scenarioById(model), [model]);
  const atoms = useMemo(() => {
    const out = new Map<string, Atom>();
    for (const reading of model.readings) {
      for (const interpretation of reading.interpretations) out.set(interpretation.id, { interpretation, reading, scenario: scenarios.get(reading.scenarioId) });
    }
    return out;
  }, [model, scenarios]);
  const max = Math.max(0, ...[...heat.values()].map((h) => h.readers));
  const hottest = [...heat.values()].sort((a, b) => b.readers - a.readers)[0]?.sentenceId;
  const [picked, setPicked] = useState<string | null>(null);
  const selected = picked ?? (hottest === undefined ? null : hottest ?? NOT_IN_TEXT);
  const finalV = finalVersion(model);
  const [showVersion, setShowVersion] = useState(0);
  const v0 = model.versions.find((v) => v.version === 0);
  const shown = model.versions.find((v) => v.version === showVersion) ?? v0;
  const v0Texts = new Set(v0?.sentences.map((s) => s.text.trim()) ?? []);

  if (!v0 || !shown) return <Section id="text" kicker="Where it breaks" title="The text, by misreading"><Empty>Waiting for the policy text…</Empty></Section>;

  const selectedHeat = selected === null ? undefined : heat.get(selected === NOT_IN_TEXT ? null : selected);
  const selectedSentence = selected === NOT_IN_TEXT ? null : v0.sentences.find((s) => s.id === selected);
  const notInText = heat.get(null);

  return (
    <Section
      id="text"
      kicker="Where it breaks"
      title="The text, shaded by how many readers misread each sentence"
      aside={finalV > 0 ? (
        <div className="flex rounded-xl bg-stone-100 p-1 text-sm">
          {[0, finalV].map((v) => (
            <button key={v} onClick={() => setShowVersion(v)} className={cx("rounded-lg px-3 py-1", showVersion === v ? "bg-white font-semibold shadow-sm" : "text-stone-600")}>
              {v === 0 ? "Original" : `Rewritten v${v}`}
            </button>
          ))}
        </div>
      ) : undefined}
    >
      <div className="grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <Card className="p-6">
          {shown.surfaces.map((surface) => (
            <div key={surface.id} className="mb-6 last:mb-0">
              <div className="mb-2 text-xs font-semibold tracking-wide text-stone-400 uppercase">{surface.label}</div>
              <div className="space-y-1">
                {shown.sentences.filter((s) => s.surfaceId === surface.id).map((sentence) => {
                  if (showVersion !== 0) {
                    const changed = !v0Texts.has(sentence.text.trim());
                    return (
                      <div key={sentence.id} className={cx("rounded-lg px-3 py-1.5 leading-relaxed", changed && "bg-emerald-50 ring-1 ring-emerald-200")}>
                        {changed && <Badge tone="good" className="mr-2">changed</Badge>}
                        {sentence.text}
                      </div>
                    );
                  }
                  const h = heat.get(sentence.id);
                  const readers = h?.readers ?? 0;
                  return (
                    <button
                      key={sentence.id}
                      onClick={() => setPicked(sentence.id)}
                      style={heatStyle(readers, max)}
                      className={cx(
                        "group flex w-full items-start gap-3 rounded-lg px-3 py-1.5 text-left leading-relaxed transition",
                        selected === sentence.id ? "ring-2 ring-stone-900" : "hover:ring-1 hover:ring-stone-300",
                      )}
                    >
                      <span className="mt-1 w-16 shrink-0 font-mono text-[11px] text-stone-400">{sentence.id}</span>
                      <span className="flex-1 text-stone-900">{sentence.text}</span>
                      {readers > 0 && <span className="mt-0.5 shrink-0 rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold text-orange-800 tabular-nums">{readers}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {showVersion === 0 && notInText && (
            <button
              onClick={() => setPicked(NOT_IN_TEXT)}
              style={heatStyle(notInText.readers, max)}
              className={cx("mt-4 flex w-full items-center gap-3 rounded-lg border border-dashed border-rose-300 px-3 py-3 text-left", selected === NOT_IN_TEXT ? "ring-2 ring-stone-900" : "hover:ring-1 hover:ring-stone-300")}
            >
              <span className="w-16 shrink-0 font-mono text-[11px] text-rose-500">not in text</span>
              <span className="flex-1 font-medium text-rose-900">Rules readers assumed that this text never states</span>
              <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-semibold text-rose-800 tabular-nums">{notInText.readers}</span>
            </button>
          )}
          {showVersion === 0 && max > 0 && (
            <div className="mt-6 flex items-center gap-2 text-xs text-stone-500">
              <span>fewer readers</span>
              <span className="h-2 w-32 rounded-full" style={{ background: "linear-gradient(90deg, rgba(249,115,22,0.08), rgba(249,115,22,0.5))" }} />
              <span>more readers holding a shared misreading</span>
            </div>
          )}
        </Card>

        <div className="lg:sticky lg:top-32 lg:self-start">
          {showVersion !== 0 ? (
            <Card className="p-6 text-sm text-stone-600">Green sentences were changed by an accepted rewrite. Switch back to Original to explore the misreadings.</Card>
          ) : selectedHeat === undefined ? (
            <Card className="p-6 text-sm text-stone-600">{max === 0 ? "No shared beliefs yet — they appear as readers finish." : "No shared misreading is anchored to this sentence."}</Card>
          ) : (
            <Card className="p-6">
              <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-stone-400 uppercase">
                <MapPin size={14} /> {selected === NOT_IN_TEXT ? "Not in the text" : selected}
              </div>
              {selectedSentence && <p className="mt-2 border-l-2 border-orange-400 pl-3 text-stone-800">{selectedSentence.text}</p>}
              <div className="mt-5 space-y-5">
                {selectedHeat.clusters.map((cluster) => (
                  <BeliefCard key={cluster.id} cluster={cluster} atoms={atoms} showConflict={hasReference(model)} />
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </Section>
  );
}

function BeliefCard(props: { cluster: Cluster; atoms: Map<string, Atom>; showConflict: boolean }): ReactNode {
  const { cluster } = props;
  const samples = cluster.interpretationIds.map((id) => props.atoms.get(id)).filter((a): a is Atom => a !== undefined);
  const unique = samples.filter((a, i) => samples.findIndex((b) => b.reading.id === a.reading.id) === i).slice(0, 2);
  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="font-medium text-stone-900">{cluster.labelEn}</div>
        <div className="flex shrink-0 gap-1">
          <Badge tone="accent">{distinctReaders(cluster)} readers</Badge>
          {props.showConflict && cluster.conflictShare > 0 && <Badge tone="bad">{pct(cluster.conflictShare)} conflict</Badge>}
        </div>
      </div>
      <div className="mt-1 text-sm text-stone-500">{cluster.labelVi}</div>
      <div className="mt-3 space-y-2">
        {unique.map(({ interpretation, scenario }) => (
          <div key={interpretation.id} className="rounded-xl bg-stone-50 px-3 py-2 text-sm">
            <div className="flex gap-2 text-stone-800"><Quote size={14} className="mt-0.5 shrink-0 text-stone-400" /><span>{interpretation.meaningVi}</span></div>
            <div className="mt-1 pl-6 text-xs text-stone-500">{interpretation.glossEn}</div>
            {scenario && <div className="mt-1 pl-6 text-xs text-stone-400">— {scenario.persona.name}, {scenario.persona.age}, {scenario.persona.province} · {scenario.exposure.attention === "skim" ? "skimmed" : "read carefully"}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
