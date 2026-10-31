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
  if (budget === 0 || findings.length === 0) return { surfaces: args.version.surfaces, edits: [] };
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
    return [{ edit, findingIds, rank: Math.min(...findingIds.map((findingId) => rankById.get(findingId)!)) }];
  });
  candidates.sort((a, b) => a.rank - b.rank);
  const accepted: SentenceEdit[] = [];
  const edits: Edit[] = [];
  const targets = new Set<string>();
  let insertions = 0;
  let surfaces = args.version.surfaces;
  for (const candidate of candidates) {
    const edit: SentenceEdit = "sentenceId" in candidate.edit
      ? { sentenceId: candidate.edit.sentenceId, newText: candidate.edit.newText }
      : { afterSentenceId: candidate.edit.afterSentenceId, text: candidate.edit.text };
    const id = "sentenceId" in edit ? edit.sentenceId : edit.afterSentenceId;
    // Count inserted sentences as changes too; an insertion cannot bypass the change budget.
    const added = "sentenceId" in edit ? Number(!targets.has(id)) : splitSentences({ id: "inserted", label: "", text: edit.text }).length;
    if (targets.size + insertions + added > budget) continue;
    try {
      surfaces = applyEdits(args.version, [...accepted, edit]);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("Overlapping edits")) throw error;
      continue; // The earlier, more severe finding owns an overlapping span.
    }
    accepted.push(edit);
    if ("sentenceId" in edit) targets.add(id);
    else insertions += added;
    edits.push({
      sentenceIds: "sentenceId" in edit ? [id] : [],
      before: "sentenceId" in edit ? sentenceById.get(id)!.text : "",
      after: "sentenceId" in edit ? edit.newText : edit.text,
      findingIds: candidate.findingIds,
    });
  }
  return { surfaces, edits };
}
