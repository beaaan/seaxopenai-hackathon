import { z } from "zod";
import { prompt } from "../core/prompts";
import { policyText, referenceText, type StageContext } from "../pipeline/context";
import {
  FindingDraft,
  type Cluster,
  type Coding,
  type Dimension,
  type Grade,
  type PolicyVersion,
  type Reading,
  type Scenario,
  type SplitRow,
} from "../shared/schema";

const JudgeOutput = z.strictObject({ findings: z.array(FindingDraft.omit({ id: true })).max(10) });

export interface DraftFindingsArgs {
  version: PolicyVersion;
  clusters: Cluster[];
  readings: Reading[];
  scenarios: Scenario[];
  grades: Grade[];
  codings: Coding[];
  dimensions: Dimension[];
  split: SplitRow[];
}

export async function draftFindings(ctx: StageContext, args: DraftFindingsArgs): Promise<FindingDraft[]> {
  if (args.clusters.length === 0) return [];
  const sentenceById = new Map(args.version.sentences.map((sentence) => [sentence.id, sentence]));
  const readingById = new Map(args.readings.map((reading) => [reading.id, reading]));
  const scenarioById = new Map(args.scenarios.map((scenario) => [scenario.id, scenario]));
  const dimensionById = new Map(args.dimensions.map((dimension) => [dimension.id, dimension]));
  const factIds = new Set(ctx.reference?.facts.map((fact) => fact.id) ?? []);
  const clusterById = new Map(args.clusters.map((cluster) => [cluster.id, cluster]));
  const clusters = args.clusters.map((cluster) => {
    const members = new Set(cluster.interpretationIds);
    const readings = [...new Set(cluster.readingIds)].flatMap((id) => {
      const reading = readingById.get(id);
      return reading ? [reading] : [];
    });
    const samples = readings.flatMap((reading) => reading.interpretations
      .filter((interpretation) => members.has(interpretation.id))
      .map((interpretation) => ({ reading, interpretation })));
    // Prefer different people over several near-identical interpretations from one reader.
    const firstByReader = new Map(samples.map((sample) => [sample.reading.id, sample]));
    const selected = [...firstByReader.values()];
    for (const sample of samples) {
      if (selected.length >= 3) break;
      if (!selected.includes(sample)) selected.push(sample);
    }
    return {
      id: cluster.id,
      labelVi: cluster.labelVi,
      labelEn: cluster.labelEn,
      size: readings.length,
      interpretationCount: members.size,
      conflictShare: cluster.conflictShare,
      sentenceId: cluster.sentenceId,
      sentenceText: cluster.sentenceId === null ? null : sentenceById.get(cluster.sentenceId)?.text ?? null,
      readingIds: readings.map((reading) => reading.id),
      scenarioIds: [...new Set(readings.map((reading) => reading.scenarioId))].filter((id) => scenarioById.has(id)),
      samples: selected.slice(0, 3).map(({ reading, interpretation }) => {
        const scenario = scenarioById.get(reading.scenarioId);
        return {
          interpretation,
          readingId: reading.id,
          scenarioId: reading.scenarioId,
          persona: scenario ? `${scenario.persona.name}, ${scenario.persona.age}, ${scenario.persona.province}; ${scenario.persona.occupation}; literacy=${scenario.persona.literacy}; payment=${scenario.persona.paymentInstruments.join(", ")}; ${scenario.persona.accountSharing}; ${scenario.persona.history}` : null,
          levels: scenario?.levels.map((choice) => {
            const dimension = dimensionById.get(choice.dimId);
            const level = dimension?.levels.find((item) => item.id === choice.levelId);
            return { ...choice, dimension: dimension?.name ?? choice.dimId, label: level?.label ?? choice.levelId };
          }) ?? [],
          actions: reading.actions,
          grade: args.grades.find((grade) => grade.readingId === reading.id && grade.interpretationId === interpretation.id) ?? null,
          beliefProbability: args.codings.find((coding) => coding.readingId === reading.id && coding.clusterId === cluster.id)?.probability ?? null,
        };
      }),
    };
  });
  const result = await ctx.gateway.structured({
    role: "judge",
    instructions: prompt("judge", { policy: policyText(args.version, { ids: true }), reference: referenceText(ctx.reference) }),
    input: JSON.stringify({
      clusters,
      dimensions: args.dimensions,
      split: args.split.map((row) => ({
        ...row,
        dimension: dimensionById.get(row.dimId)?.name ?? row.dimId,
        byLevel: row.byLevel.map((level) => ({ ...level, label: dimensionById.get(row.dimId)?.levels.find((item) => item.id === level.levelId)?.label ?? level.levelId })),
      })),
    }),
    schema: JudgeOutput,
    schemaName: "finding_drafts",
    model: ctx.config.models.judge,
    effort: "high",
  });

  const seen = new Set<string>();
  const validated = result.findings.flatMap((finding) => {
    const clusterIds = [...new Set(finding.evidence.clusterIds)].filter((id) => clusterById.has(id));
    const key = [...clusterIds].sort().join("|");
    if (clusterIds.length === 0 || seen.has(key)) return [];
    seen.add(key);
    const linkedClusters = clusterIds.map((id) => clusterById.get(id)!);
    const readingIds = [...new Set(linkedClusters.flatMap((cluster) => cluster.readingIds))].filter((id) => readingById.has(id));
    if (readingIds.length === 0) return [];
    const scenarioIds = [...new Set(readingIds.map((id) => readingById.get(id)!.scenarioId))].filter((id) => scenarioById.has(id));
    const validFacts = [...new Set(finding.factIds)].filter((id) => factIds.has(id));
    const sentenceIds = [...new Set([...finding.sentenceIds, ...linkedClusters.flatMap((cluster) => cluster.sentenceId === null ? [] : [cluster.sentenceId])])]
      .filter((id) => sentenceById.has(id));
    return [{
      draft: {
        ...finding,
        sentenceIds,
        dimsAssociated: [...new Set(finding.dimsAssociated)].filter((id) => dimensionById.has(id)),
        conflictsReference: finding.conflictsReference && validFacts.length > 0,
        factIds: validFacts,
        evidence: { clusterIds, scenarioIds, readingIds },
      },
      severity: linkedClusters.reduce((sum, cluster) => sum + new Set(cluster.readingIds.filter((id) => readingById.has(id))).size * cluster.conflictShare, 0),
    }];
  });
  validated.sort((a, b) => b.severity - a.severity);
  return validated.slice(0, 10).map(({ draft }, index) => FindingDraft.parse({ ...draft, id: `f${index + 1}` }));
}
