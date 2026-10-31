import { expect, it } from "vitest";
import { Gateway } from "../src/core/llm/gateway";
import type { StructuredRequest } from "../src/core/llm/types";
import type { StageContext } from "../src/pipeline/context";
import { writeScenarios } from "../src/sampler/scenarios";
import { RunConfig, type Dimension, type PolicyVersion } from "../src/shared/schema";

class ContradictingWriter extends Gateway {
  override async structured<T>(request: StructuredRequest<T>): Promise<T> {
    return request.schema.parse({
      persona: {
        name: "Lan", age: 48, province: "Hà Nội", occupation: "Người mua hàng",
        literacy: "medium", paymentInstruments: [], accountSharing: "Không", history: "Mua hàng COD",
      },
      situationVi: "Lan đang mua đồ dùng trong nhà bằng điện thoại.",
    });
  }
}

it("keeps designed demographic levels authoritative when the scenario writer contradicts them, without changing opt-out personas", async () => {
  const version: PolicyVersion = {
    policyId: "test", version: 0, parentVersion: null,
    surfaces: [{ id: "main", label: "Thông báo", text: "Không dùng được COD." }],
    sentences: [{ id: "main.1", surfaceId: "main", text: "Không dùng được COD." }],
  };
  const dimensions: Dimension[] = [
    { id: "age_group", name: "Nhóm tuổi", description: "Tuổi", origin: "extracted", rationale: "Phủ nhóm tuổi", levels: ["young", "middle", "older"].map((id) => ({ id, label: id, description: id })) },
    { id: "digital_literacy", name: "Thông thạo ứng dụng", description: "Đọc ứng dụng", origin: "extracted", rationale: "Phủ mức đọc", levels: ["low", "high"].map((id) => ({ id, label: id, description: id })) },
  ];
  const config = RunConfig.parse({
    policyId: "test", inputs: { policySha256: "0".repeat(64), referenceSha256: null, folkSha256: null },
    mode: "explore", budget: 50, seedSize: 16, batchSize: 10, maxIterations: 0, smokeSize: 10,
    baselineRuns: 0, seed: 7, suiteRunId: null,
    models: { reader: "test", judge: "test", grader: "test", reviewer: "test" }, fresh: false,
  });
  expect(config.demographics).toBe(false);
  const ctx: StageContext = {
    runId: "test", config: { ...config, demographics: true }, gateway: new ContradictingWriter(),
    policy: { id: "test", title: "Test", lang: "vi", sourceUrls: [], retrievedAt: "2026-10-31", surfaces: version.surfaces, notes: null },
    folk: { policyId: "test", versions: [] }, reference: null, emitThreadItem: () => {}, log: () => {},
  };
  const args = {
    version, dimensions,
    rows: ["young", "middle", "older"].flatMap((age) => ["low", "high"].map((literacy) => [
      { dimId: "age_group", levelId: age }, { dimId: "digital_literacy", levelId: literacy },
    ])),
    batch: 0, origin: "seed" as const, allocationReason: null, firstIndex: 1,
  };
  const scenarios = await writeScenarios(ctx, args);
  expect(scenarios.map((scenario) => [scenario.persona.age, scenario.persona.literacy])).toEqual([
    [25, "low"], [25, "high"], [45, "low"], [45, "high"], [55, "low"], [55, "high"],
  ]);
  const unchanged = await writeScenarios({ ...ctx, config }, args);
  expect(unchanged.every((scenario) => scenario.persona.age === 48 && scenario.persona.literacy === "medium")).toBe(true);
});
