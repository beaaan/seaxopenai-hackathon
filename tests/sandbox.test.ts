import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { Gateway } from "../src/core/llm/gateway";
import type { StageContext } from "../src/pipeline/context";
import type { ProbeStep, Reading } from "../src/shared/schema";
import { parseProbeHypothesis, runProbe } from "../src/sandbox/episode";
import { advanceDays, claimDamaged, countFailures, createAccount, createWorld, DEFAULT_ASSUMPTIONS, describeAssumptions, isLocked, placeOrder, refuseDelivery, switchPrepaid, type FailureCause, type RuleAssumptions, type World } from "../src/sandbox/rule";
import { createPersonaTools } from "../src/sandbox/tools";

const assumptions = fc.record({
  threshold: fc.integer({ min: 1, max: 8 }),
  windowDays: fc.integer({ min: 1, max: 120 }),
  countsCourierMarked: fc.boolean(),
  countsDamagedRefusal: fc.boolean(),
  recoveryPrepaidOrders: fc.integer({ min: 1, max: 4 }),
  lockScope: fc.constant("account" as const),
});
const failureCause = fc.constantFrom<FailureCause>("buyer_refused", "courier_marked", "damaged_refused");

function failOrder(world: World, cause: FailureCause = "buyer_refused", account = "account-1"): World {
  const placed = placeOrder(world, { account, payment: "cod" });
  if (!placed.orderId) throw new Error("Test attempted a COD purchase on a locked account");
  return refuseDelivery(placed.world, placed.orderId, cause).world;
}

function lockAccount(a: RuleAssumptions): World {
  let world = createWorld(a);
  for (let index = 0; index < a.threshold; index++) world = failOrder(world);
  return world;
}

describe("sandbox assumptions", () => {
  it("labels every parameter as an assumption rather than a published rule", () => {
    expect(DEFAULT_ASSUMPTIONS).toMatchObject({ threshold: 3, windowDays: 90, recoveryPrepaidOrders: 1, countsDamagedRefusal: true });
    const descriptions = describeAssumptions(DEFAULT_ASSUMPTIONS);
    expect(descriptions.map((entry) => entry.id)).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);
    for (const entry of descriptions) expect(entry.text).toContain("Assumption, not Shopee's published rule");
  });
});

describe("sandbox rule properties", () => {
  it("locks iff countable failures meet the trailing-window threshold, absent recovery", () => {
    fc.assert(fc.property(assumptions, fc.array(fc.record({ elapsed: fc.integer({ min: 0, max: 40 }), cause: failureCause }), { maxLength: 80 }), (a, attempts) => {
      let world = createWorld(a);
      for (const attempt of attempts) {
        world = advanceDays(world, attempt.elapsed);
        if (!isLocked(world, "account-1")) world = failOrder(world, attempt.cause);
        const expectedCount = world.orders.filter((order) => order.payment === "cod" && order.status === "failed" &&
          order.day > world.day - a.windowDays && order.day <= world.day && (
            order.failureCause === "buyer_refused" ||
            (order.failureCause === "courier_marked" && a.countsCourierMarked) ||
            (order.failureCause === "damaged_refused" && a.countsDamagedRefusal)
          )).length;
        expect(countFailures(world, "account-1")).toBe(expectedCount);
        expect(isLocked(world, "account-1")).toBe(expectedCount >= a.threshold);
      }
    }));
  });

  it("prepaid successes never increase the failure count", () => {
    fc.assert(fc.property(assumptions, fc.integer({ min: 0, max: 8 }), fc.array(fc.constantFrom("shopeepay" as const, "bank_transfer" as const, "card" as const, "spaylater" as const), { minLength: 1, maxLength: 12 }), (a, refusals, methods) => {
      let world = createWorld(a);
      for (let index = 0; index < Math.min(refusals, a.threshold); index++) world = failOrder(world);
      const before = countFailures(world, "account-1");
      for (const method of methods) {
        world = switchPrepaid(world, "account-1", method).world;
        expect(countFailures(world, "account-1")).toBe(before);
      }
    }));
  });

  it("counts damaged refusals exactly when that assumption is enabled", () => {
    fc.assert(fc.property(fc.boolean(), fc.integer({ min: 1, max: 12 }), (countsDamagedRefusal, threshold) => {
      let world = createWorld({ ...DEFAULT_ASSUMPTIONS, threshold, countsDamagedRefusal });
      for (let index = 0; index < threshold; index++) {
        const placed = placeOrder(world, { account: "account-1", payment: "cod" });
        if (!placed.orderId) throw new Error("Unexpected early lock");
        world = claimDamaged(placed.world, placed.orderId).world;
      }
      expect(countFailures(world, "account-1")).toBe(countsDamagedRefusal ? threshold : 0);
      expect(isLocked(world, "account-1")).toBe(countsDamagedRefusal);
    }));
  });

  it("counts courier-marked failures exactly when that assumption is enabled", () => {
    fc.assert(fc.property(fc.boolean(), (countsCourierMarked) => {
      const world = failOrder(createWorld({ ...DEFAULT_ASSUMPTIONS, threshold: 1, countsCourierMarked }), "courier_marked");
      expect(countFailures(world, "account-1")).toBe(Number(countsCourierMarked));
      expect(isLocked(world, "account-1")).toBe(countsCourierMarked);
    }));
  });

  it("keeps time monotonic and leaves prior worlds untouched", () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 1000 }), { maxLength: 100 }), (increments) => {
      let world = createWorld();
      let expectedDay = 0;
      for (const increment of increments) {
        const previous = world;
        world = advanceDays(world, increment);
        expectedDay += increment;
        expect(world.day).toBe(expectedDay);
        expect(world.day).toBeGreaterThanOrEqual(previous.day);
        expect(previous.day).toBe(expectedDay - increment);
      }
    }));
    expect(() => advanceDays(createWorld(), -1)).toThrow();
    expect(() => advanceDays(createWorld(), 0.5)).toThrow();
  });

  it("lifts a lock only after the required post-lock prepaid successes, including same-day recovery", () => {
    fc.assert(fc.property(assumptions, fc.integer({ min: 0, max: 6 }), (a, earlierSuccesses) => {
      let world = createWorld(a);
      for (let index = 0; index < earlierSuccesses; index++) world = switchPrepaid(world, "account-1", "card").world;
      for (let index = 0; index < a.threshold; index++) world = failOrder(world);
      expect(isLocked(world, "account-1")).toBe(true);
      for (let index = 1; index <= a.recoveryPrepaidOrders; index++) {
        world = switchPrepaid(world, "account-1", "bank_transfer").world;
        expect(isLocked(world, "account-1")).toBe(index < a.recoveryPrepaidOrders);
      }
      expect(countFailures(world, "account-1")).toBe(a.threshold);
      const placed = placeOrder(world, { account: "account-1", payment: "cod" });
      expect(placed.accepted).toBe(true);
      if (!placed.orderId) throw new Error("Recovered account could not order COD");
      world = refuseDelivery(placed.world, placed.orderId).world;
      expect(isLocked(world, "account-1")).toBe(true);
      expect(world.locks).toHaveLength(2);
      for (let index = 1; index <= a.recoveryPrepaidOrders; index++) {
        world = switchPrepaid(world, "account-1", "card").world;
        expect(isLocked(world, "account-1")).toBe(index < a.recoveryPrepaidOrders);
      }
    }));
  });
});

describe("sandbox rule boundaries", () => {
  it("expires failures at the exact trailing-window boundary", () => {
    const locked = lockAccount({ ...DEFAULT_ASSUMPTIONS, threshold: 1 });
    expect(isLocked(advanceDays(locked, 89), "account-1")).toBe(true);
    expect(isLocked(advanceDays(locked, 90), "account-1")).toBe(false);
    expect(countFailures(advanceDays(locked, 90), "account-1")).toBe(0);
    expect(isLocked(locked, "account-1", 90)).toBe(false);
  });

  it("rejects COD without creating an order while locked", () => {
    const world = lockAccount(DEFAULT_ASSUMPTIONS);
    const before = structuredClone(world);
    const rejected = placeOrder(world, { account: "account-1", payment: "cod" });
    expect(rejected.accepted).toBe(false);
    expect(rejected.orderId).toBeNull();
    expect(rejected.world).toEqual(before);
    expect(world).toEqual(before);
  });

  it("keeps locks account-scoped even for the same owner", () => {
    const locked = lockAccount(DEFAULT_ASSUMPTIONS);
    const created = createAccount(locked, locked.accounts[0]?.owner ?? "Người mua");
    expect(isLocked(created.world, "account-1")).toBe(true);
    expect(isLocked(created.world, created.accountId)).toBe(false);
    expect(placeOrder(created.world, { account: created.accountId, payment: "cod" }).accepted).toBe(true);
  });

  it("records a delivery outcome once, even if refused again", () => {
    const world = failOrder(createWorld());
    const repeated = refuseDelivery(world, "order-1");
    expect(repeated.accepted).toBe(false);
    expect(repeated.world.orders).toHaveLength(1);
    expect(countFailures(repeated.world, "account-1")).toBe(1);
  });
});

describe("sandbox persona tools", () => {
  it("records successes, rejections and invalid calls, and bounds time to the weekly turn", async () => {
    const world = createWorld({ ...DEFAULT_ASSUMPTIONS, threshold: 1 });
    const steps: ProbeStep[] = [];
    const tools = createPersonaTools(world, steps, { endDay: 7 });
    const place = tools.find((tool) => tool.name === "place_order");
    const refuse = tools.find((tool) => tool.name === "refuse_delivery");
    const wait = tools.find((tool) => tool.name === "wait_days");
    if (!place || !refuse || !wait) throw new Error("Missing persona tool");
    const input = { item: "áo", payment_method: "cod", value_vnd: 100_000 };
    await place.handler(input);
    await refuse.handler({ order_id: "order-1", reason: "đổi ý" });
    await place.handler(input);
    await wait.handler({ n: -1 });
    await wait.handler({ n: 100 });
    await place.handler(input);
    expect(world.day).toBe(7);
    expect(world.orders).toHaveLength(1);
    expect(steps).toHaveLength(6);
    expect(steps.map((step) => step.day)).toEqual([0, 0, 0, 0, 0, 7]);
    expect(steps[0]?.argsJson).toBe(JSON.stringify(input));
    expect(JSON.parse(steps[2]?.resultJson ?? "null")).toMatchObject({ success: false, cod_available: false, order_id: null });
    expect(JSON.parse(steps[3]?.resultJson ?? "null")).toMatchObject({ success: false });
    expect(JSON.parse(steps[4]?.resultJson ?? "null")).toMatchObject({ success: true, day: 7 });
    expect(JSON.parse(steps[5]?.resultJson ?? "null")).toMatchObject({ success: false, day: 7 });
  });
});

const observedReading: Reading = {
  id: "r-observed",
  scenarioId: "s-observed",
  policyId: "cod",
  policyVersion: 0,
  model: "observed",
  paraphraseVi: "Tài khoản mình bị khóa thì nhờ người nhà đặt hộ.",
  interpretations: [],
  questions: [],
  actions: [{ action: "use_other_account", detailVi: "Nhờ em gái đặt COD hộ khi mình bị khóa." }],
  feelingVi: "Vẫn muốn trả tiền mặt.",
};

const evidencedHypothesis = {
  hypothesis: "Theo giả định mô phỏng, người đọc tin có thể nhờ người nhà đặt hộ khi bị khóa COD.",
  supportingExcerpts: [{ readingId: observedReading.id, quoteVi: observedReading.paraphraseVi }],
  personaName: "Lan",
  persona: "Lan muốn trả tiền mặt và định nhờ em gái đặt hộ nếu tài khoản mình bị khóa.",
};

function probeContext(policyId: string): StageContext {
  return {
    runId: "sandbox-boundary-test",
    gateway: new Gateway(),
    policy: { id: policyId, title: "Test policy", lang: "vi", sourceUrls: [], retrievedAt: "2026-10-31", surfaces: [{ id: "help", label: "Help", text: "Nội dung thử nghiệm." }], notes: null },
    reference: null,
    folk: { policyId, versions: [] },
    config: {
      policyId, mode: "full", budget: 1, seedSize: 1, batchSize: 1, maxIterations: 0, smokeSize: 1, baselineRuns: 0, seed: 1, suiteRunId: null,
      inputs: { policySha256: "test", referenceSha256: null, folkSha256: null },
      models: { reader: "gpt-6.1-sol", judge: "gpt-6.1-sol", grader: "gpt-6-luna", reviewer: "gpt-6.1-sol" }, fresh: false,
    },
    emitThreadItem: () => undefined,
    log: () => undefined,
  };
}

describe("probe evidence validation", () => {
  it("accepts verbatim paraphrases and action details from the cited reading", () => {
    expect(parseProbeHypothesis(evidencedHypothesis, [observedReading])?.hypothesis).toBe(evidencedHypothesis.hypothesis);
    const action = observedReading.actions[0];
    if (!action) throw new Error("Missing observed action");
    expect(parseProbeHypothesis({ ...evidencedHypothesis, supportingExcerpts: [{ readingId: observedReading.id, quoteVi: action.detailVi }] }, [observedReading])).not.toBeNull();
  });

  it("rejects fabricated reading IDs and non-verbatim excerpts", () => {
    expect(() => parseProbeHypothesis({ ...evidencedHypothesis, supportingExcerpts: [{ readingId: "invented", quoteVi: observedReading.paraphraseVi }] }, [observedReading])).toThrow("not verbatim");
    expect(() => parseProbeHypothesis({ ...evidencedHypothesis, supportingExcerpts: [{ readingId: observedReading.id, quoteVi: "Mọi tài khoản khác đều được miễn khóa COD." }] }, [observedReading])).toThrow("not verbatim");
    expect(() => parseProbeHypothesis({ ...evidencedHypothesis, supportingExcerpts: [] }, [observedReading])).toThrow("needs supporting excerpts");
  });

  it("supports abstention without fabricating a strategy or source", () => {
    expect(parseProbeHypothesis({ hypothesis: null, supportingExcerpts: [], personaName: null, persona: null }, [observedReading])).toBeNull();
    expect(() => parseProbeHypothesis({ ...evidencedHypothesis, hypothesis: null }, [observedReading])).toThrow("must have no supporting excerpts");
  });

  it("rejects non-COD policies before any model call", async () => {
    const ctx = probeContext("grab-scheduled");
    const structured = vi.spyOn(ctx.gateway, "structured").mockRejectedValue(new Error("Unexpected model call"));
    try {
      await expect(runProbe(ctx, { readings: [], assumptions: DEFAULT_ASSUMPTIONS, days: 56 })).rejects.toThrow("no incentive simulator for policy grab-scheduled");
      expect(structured).not.toHaveBeenCalled();
    } finally {
      await ctx.gateway.close();
    }
  });

  it("rejects readings from another policy before any model call", async () => {
    const ctx = probeContext("cod");
    const structured = vi.spyOn(ctx.gateway, "structured").mockRejectedValue(new Error("Unexpected model call"));
    try {
      await expect(runProbe(ctx, { readings: [{ ...observedReading, policyId: "grab-scheduled" }], assumptions: DEFAULT_ASSUMPTIONS, days: 56 })).rejects.toThrow("must belong to policy cod");
      expect(structured).not.toHaveBeenCalled();
    } finally {
      await ctx.gateway.close();
    }
  });
});
