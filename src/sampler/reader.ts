import { z } from "zod";
import { prompt } from "../core/prompts";
import { policyText, type StageContext } from "../pipeline/context";
import { IntendedAction, Interpretation, OpenQuestion, Reading, type PolicyVersion, type Scenario } from "../shared/schema";
import { anchorQuotes } from "./anchor";

const ReaderOutput = z.strictObject({
  paraphraseVi: z.string(),
  interpretations: z.array(Interpretation.omit({ id: true, sentenceId: true })),
  questions: z.array(OpenQuestion.omit({ id: true })),
  actions: z.array(IntendedAction),
  feelingVi: z.string(),
});

export interface ReadScenarioArgs {
  scenario: Scenario;
  version: PolicyVersion;
  tag: string | null;
  fresh: boolean;
}

export async function readScenario(ctx: StageContext, args: ReadScenarioArgs): Promise<Reading> {
  const { scenario, version } = args;
  const knownSurfaces = new Set(version.surfaces.map((surface) => surface.id));
  for (const surfaceId of scenario.exposure.surfaceIds) {
    if (!knownSurfaces.has(surfaceId)) throw new Error(`Unknown exposed surface: ${surfaceId}`);
  }
  const folk = scenario.exposure.folkVersionId === null
    ? null
    : ctx.folk.versions.find((candidate) => candidate.id === scenario.exposure.folkVersionId);
  if (folk === undefined) throw new Error(`Unknown folk version: ${scenario.exposure.folkVersionId}`);
  const exposedText = policyText(version, { ids: false, surfaceIds: scenario.exposure.surfaceIds });
  const currentFriendExposure = scenario.levels.some((choice) => choice.dimId === "exposure_channel" && choice.levelId === "friend")
    && !scenario.levels.some((choice) => choice.dimId === "prior_belief" && choice.levelId !== "none");
  const output = await ctx.gateway.structured({
    role: "reader",
    instructions: prompt("reader"),
    input: JSON.stringify({
      persona: scenario.persona,
      situationVi: scenario.situationVi,
      vanBanBanThucSuNhinThay: exposedText || "Bạn không xem văn bản chính thức nào.",
      dieuDaNgheTruocDo: folk && !currentFriendExposure
        ? `Trước tình huống này, bạn đã nghe một người bạn/hàng xóm kể hoặc đọc một bài blog nói rằng: “${folk.textVi}” Đây là lời nghe kể, không phải xác nhận chính thức.`
        : "Bạn chưa nghe lời kể hay đọc blog nào về quy định này từ trước.",
      loiNguoiQuenDangKeBayGio: folk && currentFriendExposure
        ? `Ngay lúc này, một người bạn/hàng xóm đang kể với bạn: “${folk.textVi}” Đây là lần đầu bạn nghe lời kể này, không phải niềm tin đã có từ trước hay xác nhận chính thức.`
        : null,
      attention: scenario.exposure.attention,
      cachDoc: scenario.exposure.attention === "skim"
        ? "Bạn đang bận, chỉ liếc điện thoại trong khoảng 20 giây rồi phải quay lại việc đang làm."
        : "Bạn có thể dành thời gian đọc có chú ý, nhưng không đọc vượt khả năng và thói quen của mình.",
    }),
    schema: ReaderOutput,
    schemaName: "persona_reading",
    model: ctx.config.models.reader,
    effort: "low",
    fresh: args.fresh,
  });
  const anchors = await anchorQuotes(ctx, version, output.interpretations.map((interpretation) => interpretation.quote), scenario.exposure.surfaceIds);
  const readingId = `r-${scenario.id}-v${version.version}${args.tag === null || args.tag === "" ? "" : `-${args.tag}`}`;
  return Reading.parse({
    id: readingId,
    scenarioId: scenario.id,
    policyId: version.policyId,
    policyVersion: version.version,
    model: ctx.config.models.reader,
    paraphraseVi: output.paraphraseVi,
    interpretations: output.interpretations.map((interpretation, index) => ({
      ...interpretation,
      id: `${readingId}.i${index + 1}`,
      sentenceId: anchors[index] ?? null,
    })),
    questions: output.questions.map((question, index) => ({ ...question, id: `${readingId}.q${index + 1}` })),
    actions: output.actions,
    feelingVi: output.feelingVi,
  });
}
