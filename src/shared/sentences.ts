import type { Sentence, Surface } from "./schema";

/** Tokens ending in "." that never end a Vietnamese sentence in policy text. */
const ABBREVIATIONS: Record<string, true> = {
  "TP.": true,
  "Tp.": true,
  "Q.": true,
  "P.": true,
  "TX.": true,
  "TT.": true,
  "ThS.": true,
  "TS.": true,
  "PGS.": true,
  "GS.": true,
  "BS.": true,
  "v.v.": true,
};

/** "1.", "a)", "iv." — a list marker on its own is never a sentence. */
const LIST_MARKER = /^(?:\d+|[a-z]|[ivx]+)[.)]$/i;

/** Sentence end, then whitespace, then something that starts a sentence. */
const BOUNDARY = /(?<=[.!?…])\s+(?=["“(\p{Lu}\d])/u;

function lastToken(chunk: string): string {
  const tokens = chunk.trim().split(/\s+/);
  return tokens[tokens.length - 1] ?? "";
}

function splitLine(line: string): string[] {
  const parts = line.split(BOUNDARY);
  const merged: string[] = [];
  for (const part of parts) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && (ABBREVIATIONS[lastToken(prev)] === true || LIST_MARKER.test(prev.trim()))) {
      merged[merged.length - 1] = `${prev} ${part}`;
    } else {
      merged.push(part);
    }
  }
  return merged.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Deterministic splitter: every non-empty line is at least one sentence (bullets stay
 * separate), and lines split further at sentence-final punctuation. Ids are
 * `<surfaceId>.<n>`, 1-based, stable for a given text.
 */
export function splitSentences(surface: Surface): Sentence[] {
  const texts = surface.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap(splitLine);
  return texts.map((text, i) => ({ id: `${surface.id}.${i + 1}`, surfaceId: surface.id, text }));
}

export function splitSurfaces(surfaces: readonly Surface[]): Sentence[] {
  return surfaces.flatMap(splitSentences);
}
