import { Gateway } from "../core/llm/gateway";
import { loadFolk, loadPolicyPackage, loadReference } from "../core/policy";
import { readEvents } from "../core/store";
import { mapHumanAnswers } from "../eval/human";
import type { EventPayload } from "../shared/events";
import type { HumanMapping } from "../shared/schema";
import { canMapHumanAnswer, pendingHumanAnswers } from "../shared/human";
import type { StageContext } from "./context";
import { RunRecorder, rebuildRunState } from "./run";

export async function mapHumanForRun(runId: string): Promise<void> {
  const state = rebuildRunState(readEvents(runId));
  const { config, answers, questions, findings, mappings, codebook } = state;
  if (!config) throw new Error(`run ${runId} has no configuration`);
  const pending = pendingHumanAnswers(answers, mappings);
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
    recorder.emit("human.mapped", { mapping }, (latestEvents) => {
      const latestAnswers = latestEvents.flatMap((event) => event.type === "human.answer" ? [event.payload.answer] : []);
      const latestMappings = latestEvents.flatMap((event) => event.type === "human.mapped" ? [event.payload.mapping] : []);
      return canMapHumanAnswer(answer, latestAnswers, latestMappings);
    });
  }
}
