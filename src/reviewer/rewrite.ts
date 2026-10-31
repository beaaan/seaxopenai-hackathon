import { z } from "zod";
import { prompt } from "../core/prompts";
import { policyText, referenceText, type StageContext } from "../pipeline/context";
import { FidelityResult, type Edit, type Finding, type FindingDraft, type PolicyVersion, type Surface } from "../shared/schema";
import { splitSentences } from "../shared/sentences";
import { applyEdits, type SentenceEdit } from "./edits";

const Replacement = z.strictObject({ sentenceId: z.string(), newText: z.string().min(1) });
const Insertion = z.strictObject({ afterSentenceId: z.string(), text: z.string().min(1) });
const RepairOutput = z.strictObject({
  canFixByWording: z.boolean(),
  requiresNewFact: FidelityResult.shape.requiresNewFact,
  edits: z.array(z.union([Replacement, Insertion])),
});
const RewriteOutput = z.strictObject({
  edits: z.array(z.union([
    Replacement.extend({ findingIds: z.array(z.string()).min(1) }),
    Insertion.extend({ findingIds: z.array(z.string()).min(1) }),
  ])),
});

export interface RepairProposal {
  targetSentenceIds: string[];
  rewriteVi: string;
  surfaces: Surface[];
  canFixByWording: boolean;
  requiresNewFact: FidelityResult["requiresNewFact"];
}

export interface RewriteCandidate {
  surfaces: Surface[];
  edits: Edit[];
}

export interface RewritePolicyArgs {
  version: PolicyVersion;
  findings: Finding[];
  nextVersion: number;
  feedback: FidelityResult | null;
  rejected: RewriteCandidate | null;
}

export async function proposeRepair(
  ctx: StageContext,
  version: PolicyVersion,
  draft: FindingDraft,
  feedback: string | null = null,
): Promise<RepairProposal> {
  const result = await ctx.gateway.structured({
    role: "repair",
    instructions: prompt("repair", { policy: policyText(version, { ids: true }), reference: referenceText(ctx.reference) }),
    input: JSON.stringify({ finding: draft, resolutionFeedback: feedback }),
    schema: RepairOutput,
    schemaName: "minimal_policy_repair",
    model: ctx.config.models.judge,
    effort: "high",
  });
  if (result.canFixByWording === (result.requiresNewFact !== null)) {
    throw new Error("Repair must report a required new fact exactly when wording alone cannot fix the finding");
  }
  const sentenceById = new Map(version.sentences.map((sentence) => [sentence.id, sentence]));
  const edits = result.edits.filter((edit) => {
    const id = "sentenceId" in edit ? edit.sentenceId : edit.afterSentenceId;
    const sentence = sentenceById.get(id);
    if (!sentence) throw new Error(`Unknown repair sentence id: ${id}`);
    return "sentenceId" in edit ? edit.newText !== sentence.text : edit.text.trim().length > 0;
  });
  if (result.canFixByWording && edits.length === 0) throw new Error("Wording repair produced no changed text");
  const surfaces = applyEdits(version, edits);
  const sentenceOrder = new Map(version.sentences.map((sentence, index) => [sentence.id, index]));
  edits.sort((a, b) => {
    const aId = "sentenceId" in a ? a.sentenceId : a.afterSentenceId;
    const bId = "sentenceId" in b ? b.sentenceId : b.afterSentenceId;
    return sentenceOrder.get(aId)! - sentenceOrder.get(bId)! || Number("afterSentenceId" in a) - Number("afterSentenceId" in b);
  });
  return {
    targetSentenceIds: [...new Set(edits.map((edit) => "sentenceId" in edit ? edit.sentenceId : edit.afterSentenceId))],
    rewriteVi: edits.map((edit) => "sentenceId" in edit ? edit.newText : edit.text).join("\n"),
    surfaces,
    canFixByWording: result.canFixByWording,
    requiresNewFact: result.requiresNewFact,
  };
}

/** Finding ids are assigned in descending severity by draftFindings. */
export async function rewritePolicy(ctx: StageContext, args: RewritePolicyArgs): Promise<RewriteCandidate> {
  const budget = Math.floor(args.version.sentences.length * 0.4);
  const findings = args.findings.filter((finding) => finding.class === "wording_fix" && finding.repair !== null)
    .sort((a, b) => {
      const aRank = /^f(\d+)$/.exec(a.id);
      const bRank = /^f(\d+)$/.exec(b.id);
      return (aRank ? Number(aRank[1]) : Infinity) - (bRank ? Number(bRank[1]) : Infinity)
        || b.evidence.readingIds.length - a.evidence.readingIds.length;
    });
  if (findings.length === 0) return { surfaces: args.version.surfaces, edits: [] };
  if (budget === 0) {
    ctx.log("info", `Omitting repairs ${findings.map((finding) => finding.id).join(", ")}: the 40% sentence-change budget is zero.`);
    return { surfaces: args.version.surfaces, edits: [] };
  }
  const result = await ctx.gateway.structured({
    role: "rewriter",
    instructions: prompt("rewriter", { policy: policyText(args.version, { ids: true }), reference: referenceText(ctx.reference) }),
    input: JSON.stringify({ findings, nextVersion: args.nextVersion, maxChangedSentences: budget, feedback: args.feedback, rejected: args.rejected }),
    schema: RewriteOutput,
    schemaName: "merged_policy_rewrite",
    model: ctx.config.models.judge,
    effort: "high",
  });
  const sentenceById = new Map(args.version.sentences.map((sentence) => [sentence.id, sentence]));
  const rankById = new Map(findings.map((finding, index) => [finding.id, index]));
  const candidates = result.edits.flatMap((edit) => {
    const id = "sentenceId" in edit ? edit.sentenceId : edit.afterSentenceId;
    const sentence = sentenceById.get(id);
    if (!sentence) throw new Error(`Unknown rewrite sentence id: ${id}`);
    const findingIds = [...new Set(edit.findingIds)].filter((findingId) => rankById.has(findingId));
    if (findingIds.length === 0 || ("sentenceId" in edit && edit.newText === sentence.text)) return [];
    const normalized: SentenceEdit = "sentenceId" in edit
      ? { sentenceId: edit.sentenceId, newText: edit.newText }
      : { afterSentenceId: edit.afterSentenceId, text: edit.text };
    const sentenceCount = splitSentences({ id: "changed", label: "", text: "sentenceId" in edit ? edit.newText : edit.text }).length;
    return [{ edit: normalized, findingIds, cost: "sentenceId" in edit ? Math.max(1, sentenceCount) : sentenceCount }];
  });
  const accepted: SentenceEdit[] = [];
  const edits: Edit[] = [];
  const processedFindings = new Set<string>();
  let usedBudget = 0;
  let surfaces = args.version.surfaces;
  for (const finding of findings) {
    if (processedFindings.has(finding.id)) continue;
    // Shared edits connect repairs: all edits of every connected finding are atomic together.
    const componentFindingIds = new Set([finding.id]);
    const pendingFindingIds = [finding.id];
    const candidateIndices = new Set<number>();
    for (let index = 0; index < pendingFindingIds.length; index++) {
      const findingId = pendingFindingIds[index]!;
      candidates.forEach((candidate, candidateIndex) => {
        if (!candidate.findingIds.includes(findingId)) return;
        candidateIndices.add(candidateIndex);
        for (const linkedId of candidate.findingIds) {
          if (componentFindingIds.has(linkedId)) continue;
          componentFindingIds.add(linkedId);
          pendingFindingIds.push(linkedId);
        }
      });
    }
    for (const findingId of componentFindingIds) processedFindings.add(findingId);
    const group = [...candidateIndices].sort((a, b) => a - b).map((index) => candidates[index]!);
    const ids = [...componentFindingIds].join(", ");
    if (group.length === 0) {
      ctx.log("info", `Omitting repair ${ids}: no changed sentence edits were proposed.`);
      continue;
    }
    const cost = group.reduce((sum, candidate) => sum + candidate.cost, 0);
    if (usedBudget + cost > budget) {
      ctx.log("info", `Omitting entire repair ${ids}: ${cost} changed sentences exceed the remaining 40% budget of ${budget - usedBudget}.`);
      continue;
    }
    let nextSurfaces: Surface[];
    try {
      nextSurfaces = applyEdits(args.version, [...accepted, ...group.map((candidate) => candidate.edit)]);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("Overlapping edits")) throw error;
      ctx.log("warn", `Omitting entire repair ${ids}: its edits overlap each other or an earlier, more severe repair.`);
      continue;
    }
    surfaces = nextSurfaces;
    usedBudget += cost;
    for (const candidate of group) {
      const edit = candidate.edit;
      accepted.push(edit);
      edits.push({
        sentenceIds: "sentenceId" in edit ? [edit.sentenceId] : [],
        before: "sentenceId" in edit ? sentenceById.get(edit.sentenceId)!.text : "",
        after: "sentenceId" in edit ? edit.newText : edit.text,
        findingIds: candidate.findingIds,
      });
    }
  }
  return { surfaces, edits };
}
