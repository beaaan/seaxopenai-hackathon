import { Gateway } from "../core/llm/gateway";
import { loadFolk, loadPolicyPackage, loadReference } from "../core/policy";
import { readEvents } from "../core/store";
import { mapHumanAnswers } from "../eval/human";
import type { EventPayload } from "../shared/events";
import type { HumanAnswer, HumanMapping } from "../shared/schema";
import type { StageContext } from "./context";
import { RunRecorder, rebuildRunState } from "./run";

export async function mapHumanForRun(runId: string): Promise<void> {
  const state = rebuildRunState(readEvents(runId));
  const { config, answers, questions, findings, mappings, codebook } = state;
  if (!config) throw new Error(`run ${runId} has no configuration`);
  const answerKey = (answer: HumanAnswer): string => JSON.stringify([answer.questionId, answer.respondent]);
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  const mappedKeys = new Set(mappings.flatMap((mapping) => {
    const answer = byId.get(mapping.answerId);
    return answer ? [answerKey(answer)] : [];
  }));
  const latestAnswers = new Map(answers.map((answer) => [answerKey(answer), answer]));
  const pending = [...latestAnswers.values()].filter((answer) => !mappedKeys.has(answerKey(answer)));
  if (pending.length === 0) return;
  const buffered: Array<{ type: "log"; payload: EventPayload<"log"> } | { type: "thread.item"; payload: EventPayload<"thread.item"> }> = [];
  const gateway = new Gateway();
  let result: HumanMapping[];
  try {
    const policy = loadPolicyPackage(config.policyId);
    const original = state.policies.find((version) => version.version === 0);
    const ctx: StageContext = {
      runId, config, gateway, policy: original ? { ...policy, surfaces: original.surfaces } : policy,
      reference: loadReference(config.policyId), folk: loadFolk(config.policyId),
      emitThreadItem: (record) => buffered.push({ type: "thread.item", payload: { record } }),
      log: (level, message) => buffered.push({ type: "log", payload: { level, message } }),
    };
    result = await mapHumanAnswers(ctx, { answers: pending, questions, findings, codebook });
  } finally { await gateway.close(); }
  // No writer or sequence position is held while models are running.
  const recorder = new RunRecorder(runId, readEvents(runId));
  for (const event of buffered) {
    if (event.type === "log") recorder.emit("log", event.payload);
    else recorder.emit("thread.item", event.payload);
  }
  for (const mapping of result) {
    const answer = pending.find((item) => item.id === mapping.answerId);
    if (!answer) continue;
    const key = answerKey(answer);
    recorder.emit("human.mapped", { mapping }, (latestEvents) => {
      const latestAnswers = latestEvents.flatMap((event) => event.type === "human.answer" ? [event.payload.answer] : []);
      const answerById = new Map(latestAnswers.map((item) => [item.id, item]));
      if (latestAnswers.findLast((item) => answerKey(item) === key)?.id !== answer.id) return false;
      return !latestEvents.some((event) => {
        if (event.type !== "human.mapped") return false;
        const mappedAnswer = answerById.get(event.payload.mapping.answerId);
        return mappedAnswer !== undefined && answerKey(mappedAnswer) === key;
      });
    });
  }
}
