/**
 * The contract every pipeline stage works against.
 *
 * Stages are async functions `(ctx, args) => result`. They RETURN domain data; the
 * orchestrator (src/pipeline/run.ts) is the only writer of domain events. Stages may
 * emit only `thread.item` (agent transcripts) and `log` through the context.
 */
import type { Gateway } from "../core/llm/gateway";
import type { FolkFile, PolicyPackage, PolicyVersion, Reference, RunConfig, ThreadItemRecord } from "../shared/schema";

export interface StageContext {
  runId: string;
  config: RunConfig;
  gateway: Gateway;
  policy: PolicyPackage;
  /** null when the policy has no reference yet; grading then reports "unclear" only. */
  reference: Reference | null;
  folk: FolkFile;
  emitThreadItem(record: ThreadItemRecord): void;
  log(level: "info" | "warn" | "error", message: string): void;
}

/** Policy text for prompts. `ids` prefixes each sentence with `[help.3]`; `surfaceIds` limits surfaces. */
export function policyText(version: PolicyVersion, opts: { ids: boolean; surfaceIds?: readonly string[] }): string {
  const surfaces = version.surfaces.filter((s) => !opts.surfaceIds || opts.surfaceIds.includes(s.id));
  return surfaces
    .map((surface) => {
      const body = opts.ids
        ? version.sentences
            .filter((s) => s.surfaceId === surface.id)
            .map((s) => `[${s.id}] ${s.text}`)
            .join("\n")
        : surface.text;
      return `## ${surface.label}\n${body}`;
    })
    .join("\n\n");
}

/** Reference facts / not-covered items / correct readings as prompt text (never the holdout). */
export function referenceText(reference: Reference | null): string {
  if (!reference) return "(No reference has been written for this policy yet.)";
  const facts = reference.facts.map((f) => `[${f.id}] ${f.text}${f.sentenceIds.length ? ` (câu: ${f.sentenceIds.join(", ")})` : ""}${f.source ? ` (nguồn: ${f.source})` : ""}`);
  const notCovered = reference.notCovered.map((n) => `[${n.id}] ${n.text}`);
  const readings = reference.correctReadings.map((c) => `[${c.id}] H: ${c.question}\n     Đ: ${c.answer} (${c.factIds.join(", ")})`);
  return [`FACTS (văn bản nói):`, ...facts, ``, `NOT COVERED (văn bản không nói):`, ...notCovered, ``, `CORRECT READINGS:`, ...readings].join("\n");
}
