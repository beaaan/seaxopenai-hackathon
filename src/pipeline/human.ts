import { Gateway } from "../core/llm/gateway";
import { readEvents } from "../core/store";
import { mapHumanAnswers } from "../eval/human";
import type { HumanMapping } from "../shared/schema";
import { RunRecorder, createStageContext } from "./run";

export async function mapHumanForRun(runId: string): Promise<void> {
  const events = readEvents(runId);
  const recorder = new RunRecorder(runId, events);
  const { config, answers, questions, findings, mappings } = recorder.state;
  if (!config) throw new Error(`run ${runId} has no configuration`);
  const mapped = new Set(mappings.map((mapping) => mapping.answerId));
  const pending = answers.filter((answer) => !mapped.has(answer.id));
  if (pending.length === 0) return;
  const gateway = new Gateway();
  let result: HumanMapping[];
  try {
    const ctx = createStageContext(recorder, config, gateway);
    result = await mapHumanAnswers(ctx, { answers: pending, questions, findings });
  } finally { await gateway.close(); }
  for (const mapping of result) recorder.emit("human.mapped", { mapping });
}
