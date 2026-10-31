import { describe, expect, it } from "vitest";
import { z } from "zod";
import { llmJsonSchema } from "../src/core/llm/json-schema";
import * as S from "../src/shared/schema";

describe("llmJsonSchema", () => {
  it("rejects optional properties with the offending path", () => {
    const schema = z.strictObject({ a: z.strictObject({ b: z.string().optional() }) });
    expect(() => llmJsonSchema(schema)).toThrow(/\$\.a: optional properties .*\(b\)/);
  });

  it("rejects open records", () => {
    expect(() => llmJsonSchema(z.strictObject({ m: z.record(z.string(), z.number()) }))).toThrow(/open records/);
  });

  it("makes every object closed and fully required, keeping nullable fields", () => {
    const json = llmJsonSchema(z.object({ x: z.string().min(1), y: z.strictObject({ z: z.number().nullable() }) }));
    expect(json).toMatchObject({
      type: "object",
      required: ["x", "y"],
      additionalProperties: false,
      properties: { x: { type: "string" }, y: { type: "object", required: ["z"], additionalProperties: false } },
    });
    expect(JSON.stringify(json)).not.toContain("minLength");
  });

  // Shared contracts double as LLM output schemas; a teammate adding .optional() or a record breaks this.
  it.each([
    ["Reading", S.Reading],
    ["Scenario", S.Scenario],
    ["Dimension", S.Dimension],
    ["Grade", S.Grade],
    ["Cluster", S.Cluster],
    ["AllocationDecision", S.AllocationDecision],
    ["Finding", S.Finding],
    ["FidelityResult", S.FidelityResult],
    ["Rewrite", S.Rewrite],
    ["Iteration", S.Iteration],
    ["BaselineRun", S.BaselineRun],
    ["Score", S.Score],
    ["Reference", S.Reference],
    ["HumanAnswer", S.HumanAnswer],
  ])("%s converts to a strict LLM schema", (_name, schema) => {
    expect(() => llmJsonSchema(schema)).not.toThrow();
  });
});
