import { z } from "zod";
import { prompt } from "../core/prompts";
import type { StageContext } from "../pipeline/context";
import type { Cluster, Grade, Interpretation, PolicyVersion, Reading } from "../shared/schema";

const GROUPING_CHUNK_SIZE = 40;
const Grouping = z.strictObject({
  groups: z.array(z.array(z.number().int().nonnegative()).min(1).max(GROUPING_CHUNK_SIZE)).min(1).max(GROUPING_CHUNK_SIZE),
});
const Labelling = z.strictObject({
  merges: z.array(z.strictObject({
    groupIndexes: z.array(z.number().int().nonnegative()).min(1),
    labelVi: z.string().regex(/^Người đọc tin rằng \S+(?:\s+\S+){0,20}$/u),
    labelEn: z.string().regex(/^The reader believes \S+(?:\s+\S+){0,21}$/u),
  })).min(1),
});

interface Member {
  readingId: string;
  interpretation: Interpretation;
}

interface LabelledGroup {
  indexes: number[];
  labelVi: string;
  labelEn: string;
}

/** Average-linkage clustering on cosine distance; ties use the earliest input indexes. */
export function agglomerate(vectors: number[][], maxDistance: number): number[][] {
  if (!Number.isFinite(maxDistance) || maxDistance < 0) {
    throw new RangeError("Maximum cosine distance must be finite and nonnegative.");
  }
  if (vectors.length === 0) return [];
  const dimension = vectors[0]!.length;
  if (dimension === 0 || vectors.some((vector) => vector.length !== dimension || vector.some((value) => !Number.isFinite(value)))) {
    throw new Error("Clustering vectors must be finite, nonempty and equally sized.");
  }
  const count = vectors.length;
  const norms = vectors.map((vector) => Math.hypot(...vector));
  const distances = Array.from({ length: count }, () => new Float64Array(count));
  for (let left = 0; left < count; left++) {
    for (let right = left + 1; right < count; right++) {
      let dot = 0;
      // Normalise before multiplication to avoid overflow for large finite coordinates.
      if (norms[left]! > 0 && norms[right]! > 0) {
        for (let axis = 0; axis < dimension; axis++) {
          dot += (vectors[left]![axis]! / norms[left]!) * (vectors[right]![axis]! / norms[right]!);
        }
      }
      // Zero vectors carry no directional evidence, including against another zero vector.
      const distance = 1 - Math.min(1, Math.max(-1, dot));
      distances[left]![right] = distance;
      distances[right]![left] = distance;
    }
  }
  const groups = vectors.map((_, index) => [index]);
  const active = new Uint8Array(count).fill(1);
  for (;;) {
    let bestLeft = -1;
    let bestRight = -1;
    let bestDistance = Infinity;
    for (let left = 0; left < count; left++) {
      if (!active[left]) continue;
      for (let right = left + 1; right < count; right++) {
        if (active[right] && distances[left]![right]! < bestDistance) {
          bestLeft = left;
          bestRight = right;
          bestDistance = distances[left]![right]!;
        }
      }
    }
    if (bestLeft === -1 || bestDistance > maxDistance) break;
    const leftSize = groups[bestLeft]!.length;
    const rightSize = groups[bestRight]!.length;
    const totalSize = leftSize + rightSize;
    for (let other = 0; other < count; other++) {
      if (!active[other] || other === bestLeft || other === bestRight) continue;
      const average = (distances[bestLeft]![other]! * leftSize + distances[bestRight]![other]! * rightSize) / totalSize;
      distances[bestLeft]![other] = average;
      distances[other]![bestLeft] = average;
    }
    groups[bestLeft]!.push(...groups[bestRight]!);
    active[bestRight] = 0;
  }
  return groups.filter((_, index) => active[index]).map((group) => group.sort((a, b) => a - b));
}

function validatePartition(groups: number[][], count: number, stage: string): void {
  const seen = new Uint8Array(count);
  for (const group of groups) {
    if (group.length === 0) throw new Error(`${stage} returned an empty group.`);
    for (const index of group) {
      if (!Number.isInteger(index) || index < 0 || index >= count || seen[index]) {
        throw new Error(`${stage} must use every index exactly once; invalid or repeated index ${index}.`);
      }
      seen[index] = 1;
    }
  }
  if (seen.some((value) => value === 0)) throw new Error(`${stage} omitted one or more indexes.`);
}

export async function clusterInterpretations(
  ctx: StageContext,
  args: { version: PolicyVersion; readings: Reading[]; grades: Grade[]; idPrefix: string },
): Promise<Cluster[]> {
  const sentenceOrder = new Map(args.version.sentences.map((sentence, index) => [sentence.id, index]));
  const sentenceText = new Map(args.version.sentences.map((sentence) => [sentence.id, sentence.text]));
  const bySentence = new Map<string | null, Member[]>();
  for (const reading of args.readings) {
    for (const interpretation of reading.interpretations) {
      if (interpretation.sentenceId !== null && !sentenceOrder.has(interpretation.sentenceId)) {
        throw new Error(`Interpretation ${interpretation.id} refers to an unknown sentence ${interpretation.sentenceId}.`);
      }
      let members = bySentence.get(interpretation.sentenceId);
      if (members === undefined) {
        members = [];
        bySentence.set(interpretation.sentenceId, members);
      }
      members.push({ readingId: reading.id, interpretation });
    }
  }
  const sentenceGroups = [...bySentence].sort(([left], [right]) => {
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return sentenceOrder.get(left)! - sentenceOrder.get(right)!;
  });
  if (sentenceGroups.length === 0) return [];
  const groupingPrompt = ctx.gateway.hasApiKey ? null : prompt("cluster-group");
  const labellingPrompt = prompt("cluster-label");
  const conflicts = new Set(args.grades.filter((grade) => grade.label === "conflicts").map((grade) => grade.interpretationId));
  const perSentence = await Promise.all(sentenceGroups.map(async ([sentenceId, members]): Promise<Omit<Cluster, "id">[]> => {
    const context = {
      sentenceId,
      sentence: sentenceId === null ? "rule not in text" : sentenceText.get(sentenceId)!,
    };
    let groups: number[][];
    if (ctx.gateway.hasApiKey) {
      const vectors = await ctx.gateway.embed(members.map((member) => member.interpretation.glossEn));
      if (vectors.length !== members.length) throw new Error("Embedding result count does not match interpretation count.");
      groups = agglomerate(vectors, 0.25);
    } else {
      groups = [];
      for (let offset = 0; offset < members.length; offset += GROUPING_CHUNK_SIZE) {
        const chunk = members.slice(offset, offset + GROUPING_CHUNK_SIZE);
        const grouping = await ctx.gateway.structured({
          role: "cluster-group",
          instructions: groupingPrompt!,
          input: JSON.stringify({
            ...context,
            interpretations: chunk.map(({ interpretation }, index) => ({
              index,
              quote: interpretation.quote,
              meaningVi: interpretation.meaningVi,
              glossEn: interpretation.glossEn,
            })),
          }),
          schema: Grouping,
          schemaName: "interpretation_groups",
          model: ctx.config.models.reviewer,
          effort: "medium",
          fresh: ctx.config.fresh,
        });
        validatePartition(grouping.groups, chunk.length, "Interpretation grouping chunk");
        groups.push(...grouping.groups.map((indexes) => indexes.map((index) => index + offset)));
      }
    }
    validatePartition(groups, members.length, "Interpretation grouping");
    const labelled = await ctx.gateway.structured({
      role: "cluster-label",
      instructions: labellingPrompt,
      input: JSON.stringify({
        ...context,
        groups: groups.map((indexes, groupIndex) => ({
          groupIndex,
          interpretations: indexes.map((index) => {
            const interpretation = members[index]!.interpretation;
            return { index, quote: interpretation.quote, meaningVi: interpretation.meaningVi, glossEn: interpretation.glossEn };
          }),
        })),
      }),
      schema: Labelling.extend({ merges: Labelling.shape.merges.max(groups.length) }),
      schemaName: "belief_labels",
      model: ctx.config.models.reviewer,
      effort: "medium",
      fresh: ctx.config.fresh,
    });
    validatePartition(labelled.merges.map((merge) => merge.groupIndexes), groups.length, "Belief labelling merges");
    const finalGroups: LabelledGroup[] = labelled.merges.map((merge) => ({
      indexes: merge.groupIndexes.flatMap((index) => groups[index]!).sort((a, b) => a - b),
      labelVi: merge.labelVi,
      labelEn: merge.labelEn,
    }));
    finalGroups.sort((left, right) => right.indexes.length - left.indexes.length || left.indexes[0]! - right.indexes[0]!);
    return finalGroups.map((group) => {
      const groupedMembers = group.indexes.map((index) => members[index]!);
      return {
        policyVersion: args.version.version,
        sentenceId,
        interpretationIds: groupedMembers.map((member) => member.interpretation.id),
        readingIds: [...new Set(groupedMembers.map((member) => member.readingId))],
        labelVi: group.labelVi,
        labelEn: group.labelEn,
        conflictShare: groupedMembers.filter((member) => conflicts.has(member.interpretation.id)).length / groupedMembers.length,
      };
    });
  }));
  return perSentence.flat().map((cluster, index) => ({ ...cluster, id: `${args.idPrefix}-${index + 1}` }));
}
