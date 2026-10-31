import { z } from "zod";
import type { HumanAnswer, HumanMapping } from "./schema";

const Submission = z.strictObject({
  respondent: z.string().trim().min(1),
  answers: z.array(z.strictObject({ questionId: z.string().min(1), answerVi: z.string().trim().min(1) })).min(1),
});
/** Old clients get a new server-generated identity per submission; names are never used for new identities. */
export const HumanAnswersRequest = z.union([Submission.extend({ respondentId: z.string().uuid() }), Submission]);

export function humanRespondentKey(answer: HumanAnswer): string {
  return JSON.stringify(answer.respondentId === null ? ["legacy", answer.respondent] : ["id", answer.respondentId]);
}

function answerKey(answer: HumanAnswer): string {
  return JSON.stringify([humanRespondentKey(answer), answer.questionId]);
}

/** Latest revisions only; the event log keeps every answer and mapping for audit. */
export function latestHumanAnswers(answers: readonly HumanAnswer[]): HumanAnswer[] {
  return [...new Map(answers.map((answer) => [answerKey(answer), answer])).values()];
}

export function pendingHumanAnswers(answers: readonly HumanAnswer[], mappings: readonly HumanMapping[]): HumanAnswer[] {
  const mapped = new Set(mappings.map((mapping) => mapping.answerId));
  return latestHumanAnswers(answers).filter((answer) => !mapped.has(answer.id));
}

/** Rechecked under the append lock after model calls: don't publish stale revisions or concurrent duplicates. */
export function canMapHumanAnswer(answer: HumanAnswer, answers: readonly HumanAnswer[], mappings: readonly HumanMapping[]): boolean {
  return pendingHumanAnswers(answers, mappings).some((pending) => pending.id === answer.id);
}

export interface HumanIdentityStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** One identity per run and browser, reset explicitly for a different person using the same device. */
export function humanRespondentId(runId: string, storage: HumanIdentityStorage | null, renew = false): string {
  const key = `pwt-human-v1:${runId}`;
  try {
    const saved = storage?.getItem(key);
    if (!renew && saved && z.string().uuid().safeParse(saved).success) return saved;
  } catch { /* Storage may be disabled; retain the generated identity in component state. */ }
  // getRandomValues also works on the plain-HTTP LAN origin used by venue phones; randomUUID requires HTTPS.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  try { storage?.setItem(key, id); } catch { /* In-memory identity still supports submission and retries. */ }
  return id;
}
