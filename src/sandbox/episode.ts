import { z } from "zod";
import { prompt } from "../core/prompts";
import type { StageContext } from "../pipeline/context";
import { ProbeResult, Reading, type ProbeStep } from "../shared/schema";
import { advanceDays, createWorld, describeAssumptions, type RuleAssumptions } from "./rule";
import { createPersonaTools, type ProbeClock } from "./tools";

const HypothesisOutput = z.strictObject({
  hypothesis: z.string().min(1).nullable(),
  supportingExcerpts: z.array(z.strictObject({
    readingId: z.string().min(1),
    quoteVi: z.string().min(1).max(800),
  })).max(6),
  personaName: z.string().min(1).nullable(),
  persona: z.string().min(1).nullable(),
});

export interface ProbeHypothesis {
  hypothesis: string;
  supportingExcerpts: Array<{ readingId: string; quoteVi: string }>;
  personaName: string;
  persona: string;
}

/** Validate provenance before any generated hypothesis can seed a persona. */
export function parseProbeHypothesis(value: unknown, readings: readonly Reading[]): ProbeHypothesis | null {
  const selected = HypothesisOutput.parse(value);
  if (selected.hypothesis === null) {
    if (selected.supportingExcerpts.length !== 0) throw new Error("An abstaining probe hypothesis must have no supporting excerpts.");
    return null;
  }
  if (selected.supportingExcerpts.length === 0 || selected.personaName === null || selected.persona === null) {
    throw new Error("An evidenced probe hypothesis needs supporting excerpts and a persona.");
  }
  for (const excerpt of selected.supportingExcerpts) {
    const reading = readings.find((entry) => entry.id === excerpt.readingId);
    const sources = reading ? [reading.paraphraseVi, ...reading.actions.map((action) => action.detailVi)] : [];
    if (excerpt.quoteVi.trim().length === 0 || !sources.some((source) => source.includes(excerpt.quoteVi))) {
      throw new Error(`Probe excerpt is not verbatim evidence from reading ${excerpt.readingId}.`);
    }
  }
  return { hypothesis: selected.hypothesis, supportingExcerpts: selected.supportingExcerpts, personaName: selected.personaName, persona: selected.persona };
}

export async function runProbe(ctx: StageContext, args: { readings: Reading[]; assumptions: RuleAssumptions; days: number }): Promise<ProbeResult | null> {
  if (ctx.policy.id !== "cod") throw new Error(`no incentive simulator for policy ${ctx.policy.id}`);
  const readings = z.array(Reading).min(1).parse(args.readings);
  if (readings.some((reading) => reading.policyId !== ctx.policy.id)) {
    throw new Error(`Probe readings must belong to policy ${ctx.policy.id}.`);
  }
  const days = z.number().int().positive().parse(args.days);
  const selected = parseProbeHypothesis(await ctx.gateway.structured({
    role: "probe_hypothesis",
    instructions: prompt("probe-hypothesis"),
    input: JSON.stringify(readings.map((reading) => ({ id: reading.id, paraphraseVi: reading.paraphraseVi, actions: reading.actions }))),
    schema: HypothesisOutput,
    schemaName: "probe_hypothesis",
    model: ctx.config.models.reader,
    effort: "low",
    fresh: ctx.config.fresh,
  }), readings);
  if (selected === null) return null;

  const derivedFromReadingIds = [...new Set(selected.supportingExcerpts.map((excerpt) => excerpt.readingId))];
  const observedReadings = readings.filter((reading) => derivedFromReadingIds.includes(reading.id)).map((reading) => ({
    id: reading.id,
    paraphraseVi: reading.paraphraseVi,
    actions: reading.actions,
  }));
  const world = createWorld(args.assumptions);
  const assumptions = describeAssumptions(world.assumptions);

  const steps: ProbeStep[] = [];
  const clock: ProbeClock = { endDay: Math.min(7, days) };
  const tools = createPersonaTools(world, steps, clock);
  const thread = await ctx.gateway.agentThread({
    role: "probe",
    label: selected.personaName,
    instructions: prompt("probe-persona", {
      personaName: selected.personaName,
      persona: selected.persona,
      observedReadings: JSON.stringify(observedReadings),
    }),
    tools,
    model: ctx.config.models.reader,
    effort: "low",
    persist: true,
    onItem: (item) => ctx.emitThreadItem(item),
  });
  try {
    for (let startDay = 0, week = 1; startDay < days; startDay += 7, week++) {
      clock.endDay = Math.min(startDay + 7, days);
      await thread.turn(`Tuần ${week}: từ ngày ${startDay} đến trước ngày ${clock.endDay} trong mô phỏng ${days} ngày. Hiện tại là ngày ${world.day}. Hãy tiếp tục sống và mua hàng theo vai của bạn, dùng công cụ nếu cần, rồi kết thúc lượt.`);
      Object.assign(world, advanceDays(world, clock.endDay - world.day));
    }
  } finally {
    await thread.close();
  }

  const outcome = {
    codOrders: world.orders.filter((order) => order.payment === "cod").length,
    refusals: world.orders.filter((order) => order.status === "failed").length,
    locks: world.locks.length,
    refusalsWithoutLock: world.orders.filter((order) => order.status === "failed" && order.lockedAfterFailure === false).length,
    accountsCreated: world.accounts.length - 1,
  };
  const assumptionIds = assumptions.map((assumption) => assumption.id).join(", ");
  return ProbeResult.parse({
    hypothesis: selected.hypothesis,
    derivedFromReadingIds,
    assumptions,
    persona: selected.persona,
    days,
    steps,
    outcome,
    summary: `Giả thuyết về điều cách diễn đạt khuyến khích, chỉ dưới các giả định ${assumptionIds}: «${selected.hypothesis}». Trong ${days} ngày mô phỏng, người mua đặt ${outcome.codOrders} đơn COD, có ${outcome.refusals} lần giao thất bại/từ chối, ${outcome.locks} đợt khóa, ${outcome.refusalsWithoutLock} lần thất bại mà ngay sau đó tài khoản không bị khóa và tạo thêm ${outcome.accountsCreated} tài khoản mô phỏng. Đây là quan sát trong thế giới giả định để xem xét động cơ từ câu chữ, không xác nhận giả thuyết là đúng trên Shopee và không phải kết luận về lỗ hổng của nền tảng.`,
  });
}
