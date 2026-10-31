import type { PolicyVersion, Surface } from "../shared/schema";

export type SentenceEdit =
  | { sentenceId: string; newText: string }
  | { afterSentenceId: string; text: string };

interface TextPatch {
  start: number;
  end: number;
  text: string;
}

/** Resolve all edits against the original text, so earlier edits cannot move later anchors. */
export function applyEdits(version: PolicyVersion, edits: SentenceEdit[]): Surface[] {
  const sentences = new Map(version.sentences.map((sentence) => [sentence.id, sentence]));
  const surfaces = new Map(version.surfaces.map((surface) => [surface.id, surface]));
  const offsets = new Map<string, { start: number; end: number }>();
  const cursors = new Map<string, number>();
  for (const sentence of version.sentences) {
    const surface = surfaces.get(sentence.surfaceId);
    if (!surface) throw new Error(`Unknown surface for sentence ${sentence.id}: ${sentence.surfaceId}`);
    const start = surface.text.indexOf(sentence.text, cursors.get(surface.id) ?? 0);
    if (sentence.text.length === 0 || start < 0) {
      throw new Error(`Sentence ${sentence.id} does not occur exactly in its surface in sentence order`);
    }
    const end = start + sentence.text.length;
    offsets.set(sentence.id, { start, end });
    cursors.set(surface.id, end);
  }
  const patches = new Map<string, TextPatch[]>();

  for (const edit of edits) {
    const id = "sentenceId" in edit ? edit.sentenceId : edit.afterSentenceId;
    const sentence = sentences.get(id);
    if (!sentence) throw new Error(`Unknown sentence id: ${id}`);
    const surface = surfaces.get(sentence.surfaceId);
    if (!surface) throw new Error(`Unknown surface for sentence ${id}: ${sentence.surfaceId}`);
    const { start, end } = offsets.get(id)!;
    const patch: TextPatch = "sentenceId" in edit
      ? { start, end, text: edit.newText }
      : {
          start: end,
          end,
          text: `\n${edit.text}${end === surface.text.length || /^[\r\n]/.test(surface.text.slice(end)) ? "" : "\n"}`,
        };
    const group = patches.get(surface.id) ?? [];
    group.push(patch);
    patches.set(surface.id, group);
  }

  return version.surfaces.map((surface) => {
    const group = patches.get(surface.id);
    if (!group) return surface;
    group.sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 1; i < group.length; i++) {
      const previous = group[i - 1]!;
      const current = group[i]!;
      if (current.start < previous.end || (current.start === previous.start && current.end === previous.end)) {
        throw new Error(`Overlapping edits in surface ${surface.id}`);
      }
    }
    let text = surface.text;
    for (let i = group.length - 1; i >= 0; i--) {
      const patch = group[i]!;
      text = text.slice(0, patch.start) + patch.text + text.slice(patch.end);
    }
    return { ...surface, text };
  });
}
