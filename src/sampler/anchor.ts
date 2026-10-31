import type { StageContext } from "../pipeline/context";
import type { PolicyVersion } from "../shared/schema";

function normalize(text: string): string {
  return text.normalize("NFC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function trigrams(text: string): Set<string> {
  const chars = Array.from(text);
  const result = new Set<string>();
  for (let i = 0; i + 2 < chars.length; i++) result.add(chars[i]! + chars[i + 1]! + chars[i + 2]!);
  return result;
}

/** Character-trigram Jaccard; canonically equivalent Vietnamese text is identical. */
export function trigramSimilarity(a: string, b: string): number {
  const left = normalize(a);
  const right = normalize(b);
  if (left === right) return 1;
  const leftTrigrams = trigrams(left);
  const rightTrigrams = trigrams(right);
  let intersection = 0;
  for (const gram of leftTrigrams) if (rightTrigrams.has(gram)) intersection++;
  const union = leftTrigrams.size + rightTrigrams.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Resolve quotes only against official surfaces that this reader actually saw. */
export async function anchorQuotes(
  ctx: StageContext,
  version: PolicyVersion,
  quotes: string[],
  surfaceIds: readonly string[],
): Promise<Array<string | null>> {
  const visible = new Set(surfaceIds);
  const sentences = version.sentences.filter((sentence) => visible.has(sentence.surfaceId));
  const anchors: Array<string | null> = quotes.map(() => null);
  if (sentences.length === 0 || quotes.length === 0) return anchors;

  const normalizedSentences = sentences.map((sentence) => normalize(sentence.text));
  const unresolved: Array<{ index: number; quote: string }> = [];
  for (const [index, quote] of quotes.entries()) {
    const normalizedQuote = normalize(quote);
    if (normalizedQuote.length === 0) continue;
    let bestIndex = -1;
    let bestSimilarity = -1;
    // Short/generic fragments need similarity or a Decision, not mere containment.
    const allowContainment = normalizedQuote.length >= 12 && normalizedQuote.split(" ").length >= 3;
    let bestContainedIndex = -1;
    let bestContainedSimilarity = -1;
    for (const [sentenceIndex, sentence] of sentences.entries()) {
      const similarity = trigramSimilarity(quote, sentence.text);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestIndex = sentenceIndex;
      }
      if (allowContainment && normalizedSentences[sentenceIndex]!.includes(normalizedQuote) && similarity > bestContainedSimilarity) {
        bestContainedSimilarity = similarity;
        bestContainedIndex = sentenceIndex;
      }
    }
    if (bestContainedIndex !== -1) anchors[index] = sentences[bestContainedIndex]!.id;
    else if (bestSimilarity >= 0.5) anchors[index] = sentences[bestIndex]!.id;
    else unresolved.push({ index, quote });
  }

  if (unresolved.length === 0) return anchors;
  const choices = [
    ...sentences.map((sentence) => ({ value: sentence.id, description: sentence.text })),
    { value: "none", description: "Không câu nào trong phần văn bản đã được xem chứa ý hay đoạn trích này; có thể chỉ là lời truyền miệng." },
  ];
  const answers = await ctx.gateway.decide({
    role: "anchor",
    evidence: "Map each reader quote to its source sentence in the text the reader saw. Select none for an invented quote, a folk claim not in these sentences, or an unsupported association. Do not infer a source merely because it discusses a related topic.\n\n"
      + sentences.map((sentence) => `[${sentence.id}] ${sentence.text}`).join("\n"),
    data: unresolved.map(({ index, quote }) => ({ name: `quote_${index}`, quote })),
    questions: unresolved.map(({ index, quote }) => ({
      type: "choice" as const,
      name: `quote_${index}`,
      instructions: `Which visible sentence is the source of this quote? Quote: ${JSON.stringify(quote)}`,
      choices,
    })),
  });
  const byName = new Map(answers.map((answer) => [answer.name, answer]));
  const sentenceIds = new Set(sentences.map((sentence) => sentence.id));
  for (const { index } of unresolved) {
    const answer = byName.get(`quote_${index}`);
    if (answer?.type === "choice" && sentenceIds.has(answer.choice)) anchors[index] = answer.choice;
  }
  return anchors;
}
