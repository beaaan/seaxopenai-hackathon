import { describe, expect, it } from "vitest";
import { Gateway } from "../src/core/llm/gateway";
import type { AgentThread, AgentThreadOptions, OutputSchema, TurnResult } from "../src/core/llm/types";
import type { StageContext } from "../src/pipeline/context";
import { createReviewer, rowsForDecision, type ReviewerDecideArgs } from "../src/sampler/allocate";
import type { AllocationDecision, Dimension, Reading, Scenario } from "../src/shared/schema";

const dimensions: Dimension[] = ["a", "b"].map((id) => ({
  id, name: id, description: id, origin: "extracted", rationale: "test",
  levels: [0, 1, 2].map((index) => ({ id: `${id}${index}`, label: String(index), description: String(index) })),
}));

function decision(overrides: Partial<AllocationDecision> = {}): AllocationDecision {
  return { batch: 1, split: [], discovery: [], focusDimIds: ["a", "b"], newLevels: [], n: 15, stopExploring: false, rationale: "test", decidedBy: "reviewer", ...overrides };
}

function reviewerArgs(overrides: Partial<ReviewerDecideArgs> = {}): ReviewerDecideArgs {
  return {
    batch: 2, remainingBudget: 7, batchSize: 10, dimensions, split: [{ dimId: "a", nmi: 0.8, z: 4, byLevel: [] }, { dimId: "b", nmi: 0.1, z: 0.5, byLevel: [] }],
    discovery: [{ batch: 0, readings: 10, newClusters: 2 }, { batch: 1, readings: 20, newClusters: 1 }], clusters: [], readings: [], scenarios: [], ...overrides,
  };
}

const validOutput = { focusDimIds: ["a"], newLevels: [], n: 5, stopExploring: false, rationale: "Inspect the split" };

class OutputGateway extends Gateway {
  constructor(readonly output: unknown, readonly inspect?: (options: AgentThreadOptions) => Promise<void>) {
    super();
  }

  override async agentThread(options: AgentThreadOptions): Promise<AgentThread> {
    if (this.output instanceof Error) throw this.output;
    return {
      threadId: "test-reviewer",
      turn: async (_input: string, _schema?: OutputSchema): Promise<TurnResult> => {
        await this.inspect?.(options);
        return { threadId: "test-reviewer", finalText: JSON.stringify(this.output), items: [] };
      },
      close: async () => {},
    };
  }
}

function context(gateway: Gateway): StageContext {
  return {
    runId: "test", gateway, policy: { id: "test", title: "test", lang: "vi", sourceUrls: [], retrievedAt: "2026-01-01", surfaces: [{ id: "main", label: "main", text: "test" }], notes: null },
    reference: null, folk: { policyId: "test", versions: [] },
    config: { policyId: "test", mode: "explore", budget: 50, seedSize: 16, batchSize: 10, maxIterations: 3, smokeSize: 10, baselineRuns: 0, seed: 7, suiteRunId: null, fresh: false, models: { reader: "test", judge: "test", grader: "test", reviewer: "test" } },
    emitThreadItem: () => {}, log: () => {},
  };
}

describe("rowsForDecision", () => {
  it("reserves exactly the random prefix before cycling focused dimensions through levels", () => {
    const first = rowsForDecision(dimensions, decision(), 17);
    const switched = rowsForDecision(dimensions, decision({ focusDimIds: ["b", "a"] }), 17);
    expect(first).toHaveLength(15);
    expect(first.slice(0, 3)).toEqual(switched.slice(0, 3));
    expect(first.slice(3).map((row, index) => row.find((choice) => choice.dimId === (index % 2 === 0 ? "a" : "b"))?.levelId)).toEqual([
      "a0", "b0", "a1", "b1", "a2", "b2", "a0", "b0", "a1", "b1", "a2", "b2",
    ]);
    for (const row of first) {
      expect(row).toHaveLength(dimensions.length);
      for (const choice of row) expect(dimensions.find((dimension) => dimension.id === choice.dimId)?.levels.map((level) => level.id)).toContain(choice.levelId);
    }
  });

  it("is seeded, changes with seed, and reserves ceil(20%) even for small batches", () => {
    const allocation = decision({ n: 7, focusDimIds: ["a"] });
    expect(rowsForDecision(dimensions, allocation, 1)).toEqual(rowsForDecision(dimensions, allocation, 1));
    expect(rowsForDecision(dimensions, allocation, 2)).not.toEqual(rowsForDecision(dimensions, allocation, 1));
    expect(rowsForDecision(dimensions, allocation, 1).slice(2).map((row) => row[0]?.levelId)).toEqual(["a0", "a1", "a2", "a0", "a1"]);
    const single = decision({ n: 1 });
    expect(rowsForDecision(dimensions, single, 8)).toEqual(rowsForDecision(dimensions, { ...single, focusDimIds: ["b"] }, 8));
    expect(rowsForDecision(dimensions, decision({ n: 0 }), 8)).toEqual([]);
    expect(() => rowsForDecision(dimensions, decision({ n: -1 }), 8)).toThrow(/nonnegative integer/);
  });

  it("includes new levels without mutating dimensions or duplicating levels already merged by the caller", () => {
    const addition = { dimId: "a", level: { id: "wallet_empty", label: "Empty wallet", description: "Has a wallet but no balance" } };
    const allocation = decision({ focusDimIds: ["a"], newLevels: [addition], n: 10 });
    const rows = rowsForDecision(dimensions, allocation, 7);
    expect(rows.slice(2).map((row) => row[0]?.levelId)).toEqual(["a0", "a1", "a2", "wallet_empty", "a0", "a1", "a2", "wallet_empty"]);
    expect(dimensions[0]?.levels).toHaveLength(3);
    const merged = dimensions.map((dimension) => dimension.id === "a" ? { ...dimension, levels: [...dimension.levels, addition.level] } : dimension);
    expect(rowsForDecision(merged, allocation, 7)).toEqual(rows);
  });

  it("samples nonfocused dimensions uniformly across their entire level set", () => {
    const rows = rowsForDecision(dimensions, decision({ focusDimIds: ["a"], n: 1000 }), 31);
    const counts = new Map<string, number>();
    for (const row of rows.slice(200)) {
      const level = row.find((choice) => choice.dimId === "b")?.levelId ?? "";
      counts.set(level, (counts.get(level) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual(["b0", "b1", "b2"]);
    for (const count of counts.values()) expect(count).toBeGreaterThan(200);
  });
});

describe("reviewer allocation guardrails", () => {
  it("clamps the model's n to both hard budget bounds and fills evidence in code", async () => {
    const reviewer = await createReviewer(context(new OutputGateway({ ...validOutput, n: 999 })));
    const args = reviewerArgs();
    const actual = await reviewer.decide(args);
    expect(actual).toMatchObject({ n: 7, batch: 2, split: args.split, discovery: args.discovery, decidedBy: "reviewer" });
    expect((await reviewer.decide({ ...args, remainingBudget: 20, batchSize: 4 })).n).toBe(4);
    await reviewer.close();
  });

  it.each([
    { ...validOutput, focusDimIds: ["missing"] },
    { ...validOutput, focusDimIds: ["a", "a"] },
    { ...validOutput, n: 0 },
    { ...validOutput, newLevels: [{ dimId: "missing", level: { id: "fresh", label: "x", description: "x" } }] },
    { ...validOutput, newLevels: [{ dimId: "a", level: { id: "a0", label: "x", description: "x" } }] },
    { ...validOutput, newLevels: ["a", "b"].map((dimId) => ({ dimId, level: { id: "duplicate", label: "x", description: "x" } })) },
  ])("rejects invalid external allocation output %# and falls back to split evidence", async (output) => {
    const reviewer = await createReviewer(context(new OutputGateway(output)));
    const actual = await reviewer.decide(reviewerArgs());
    expect(actual).toMatchObject({ focusDimIds: ["a"], newLevels: [], n: 7, stopExploring: false, decidedBy: "fallback" });
    expect(actual.rationale).toContain("invalid");
    await reviewer.close();
  });

  it.each(["exposure_channel", "prior_belief", "attention"])("rejects invented levels on built-in dimension %s while permitting focus on it", async (dimId) => {
    const args = reviewerArgs({ dimensions: [...dimensions, { ...dimensions[0]!, id: dimId }] });
    const invalid = await createReviewer(context(new OutputGateway({
      ...validOutput,
      focusDimIds: [dimId],
      newLevels: [{ dimId, level: { id: "invented_exposure", label: "Invented", description: "Not representable by Exposure" } }],
    })));
    const fallback = await invalid.decide(args);
    expect(fallback.decidedBy).toBe("fallback");
    expect(fallback.newLevels).toEqual([]);
    expect(fallback.rationale).toContain("built-in exposure dimension");
    await invalid.close();
    const valid = await createReviewer(context(new OutputGateway({ ...validOutput, focusDimIds: [dimId] })));
    expect(await valid.decide(args)).toMatchObject({ focusDimIds: [dimId], decidedBy: "reviewer" });
    await valid.close();
  });

  it("uses top-two significant dimensions, saturation, and low-split top-one rules after a thread error", async () => {
    const reviewer = await createReviewer(context(new OutputGateway(new Error("server unavailable"))));
    const args = reviewerArgs({ split: [{ dimId: "b", nmi: 0.4, z: 2, byLevel: [] }, { dimId: "a", nmi: 0.8, z: 6, byLevel: [] }], discovery: [{ batch: 1, readings: 10, newClusters: 0 }, { batch: 2, readings: 20, newClusters: 0 }] });
    expect(await reviewer.decide(args)).toMatchObject({ focusDimIds: ["a", "b"], stopExploring: true, decidedBy: "fallback" });
    expect((await reviewer.decide({ ...args, split: args.split.map((row) => ({ ...row, z: row.dimId === "b" ? 0.8 : -1 })) })).focusDimIds).toEqual(["b"]);
    expect(await reviewer.decide({ ...args, remainingBudget: 0 })).toMatchObject({ n: 0, stopExploring: true });
    await reviewer.close();
  });

  it("filters tool evidence using the latest scenarios, including persona and exposure", async () => {
    const seen: unknown[] = [];
    const gateway = new OutputGateway(validOutput, async (options) => {
      const tool = options.tools.find((item) => item.name === "get_readings");
      if (!tool) throw new Error("get_readings missing");
      seen.push(await tool.handler({ dimId: "a", levelId: "a1" }));
    });
    const reviewer = await createReviewer(context(gateway));
    const readings: Reading[] = [0, 1].map((index) => ({ id: `r${index}`, scenarioId: `s${index}`, policyId: "test", policyVersion: 0, model: "test", paraphraseVi: `reading ${index}`, interpretations: [], questions: [], actions: [], feelingVi: "" }));
    const scenarios: Scenario[] = [0, 1].map((index) => ({ id: `s${index}`, policyId: "test", batch: 0, origin: "seed", levels: [{ dimId: "a", levelId: `a${index}` }], persona: { name: `Persona ${index}`, age: 30, province: "Hà Nội", occupation: "test", literacy: "medium", paymentInstruments: [], accountSharing: "none", history: "none" }, exposure: { surfaceIds: ["main"], folkVersionId: null, attention: "skim" }, situationVi: "test", allocationReason: null }));
    await reviewer.decide(reviewerArgs({ readings, scenarios }));
    await reviewer.decide(reviewerArgs({ readings: [readings[0]!], scenarios: [{ ...scenarios[0]!, levels: [{ dimId: "a", levelId: "a1" }] }] }));
    expect(seen).toMatchObject([
      [{ id: "r1", paraphraseVi: "reading 1", persona: expect.stringContaining("Persona 1"), exposure: { surfaceIds: ["main"] } }],
      [{ id: "r0", paraphraseVi: "reading 0", persona: expect.stringContaining("Persona 0") }],
    ]);
    await reviewer.close();
  });
});
