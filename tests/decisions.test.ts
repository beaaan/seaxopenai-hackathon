import { describe, expect, it } from "vitest";
import type { Decision, DecisionCreateParams } from "openai/resources/decisions";
import { decideChunked, emulateDecisions, MAX_QUESTIONS_PER_REQUEST, type DecisionAnswer, type DecisionQuestion } from "../src/core/llm/decisions";
import { Limiter } from "../src/core/llm/limit";

const predicates = (n: number): DecisionQuestion[] =>
  Array.from({ length: n }, (_, i) => ({ type: "predicate", name: `q${i}`, instructions: `holds belief ${i}?` }));

/** Answers each predicate with probability i/1000 and returns them in reverse order. */
async function fakeCreate(body: DecisionCreateParams): Promise<Decision> {
  const answers: Decision["answers"] = body.questions.map((q) => {
    const i = Number(q.name?.slice(1));
    return q.name === "q7" ? { type: "refusal", name: q.name } : { type: "predicate", name: q.name ?? null, probability: i / 1000 };
  });
  return { answers: answers.reverse(), model: body.model, usage: { input_tokens: 0, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens: 0, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 0 } };
}

describe("decideChunked", () => {
  it("splits at the 400-question limit and returns answers in question order by name", async () => {
    const bodies: DecisionCreateParams[] = [];
    const answers = await decideChunked(
      async (body) => {
        bodies.push(body);
        return fakeCreate(body);
      },
      new Limiter(4),
      { role: "coder", evidence: "policy + reference", data: { reading: "r1" }, questions: predicates(MAX_QUESTIONS_PER_REQUEST + 50) },
    );
    expect(bodies.map((b) => b.questions.length)).toEqual([MAX_QUESTIONS_PER_REQUEST, 50]);
    expect(answers).toHaveLength(MAX_QUESTIONS_PER_REQUEST + 50);
    expect(answers[0]).toEqual({ type: "predicate", name: "q0", probability: 0 });
    expect(answers[449]).toEqual({ type: "predicate", name: "q449", probability: 0.449 });
    expect(answers[7]).toEqual({ type: "refusal", name: "q7" });
  });

  it("sends the same shared evidence first in every chunk so the prompt cache prefix matches", async () => {
    const bodies: DecisionCreateParams[] = [];
    await decideChunked(
      async (body) => {
        bodies.push(body);
        return fakeCreate(body);
      },
      new Limiter(2),
      { role: "grader", evidence: "SHARED", data: null, questions: predicates(MAX_QUESTIONS_PER_REQUEST + 1) },
    );
    expect(bodies[0]?.input).toEqual(bodies[1]?.input);
    expect(JSON.stringify(bodies[0]?.input)).toContain("SHARED");
    expect(JSON.stringify(bodies[0]?.input)).not.toContain("input_json");
  });

  it("rejects duplicate question names", async () => {
    const qs: DecisionQuestion[] = [...predicates(2), { type: "predicate", name: "q1", instructions: "again" }];
    await expect(decideChunked(fakeCreate, new Limiter(1), { role: "x", evidence: "e", data: null, questions: qs })).rejects.toThrow(/duplicate question name "q1"/);
  });
});

describe("emulateDecisions", () => {
  const label: DecisionQuestion = {
    type: "choice",
    name: "label",
    instructions: "how does the reading relate to the text?",
    choices: [{ value: "consistent", description: "" }, { value: "conflicts", description: "" }, { value: "outside", description: "" }],
  };
  const emulate = (choice: string | null, choiceProbabilities: Array<{ value: string; probability: number }> | null): Promise<DecisionAnswer[]> =>
    emulateDecisions(
      async () => ({ answers: [{ name: "label", probability: null, choice, choiceProbabilities, levelIndex: null, confidence: 0.7 }] }),
      { role: "grade", evidence: "e", data: null, questions: [label] },
    );

  it("normalises a distribution that covers every allowed value exactly once", async () => {
    const [answer] = await emulate("conflicts", [{ value: "consistent", probability: 0.25 }, { value: "conflicts", probability: 1 }, { value: "outside", probability: 0.75 }]);
    expect(answer).toEqual({
      type: "choice", name: "label", choice: "conflicts", confidence: 0.5,
      probabilities: [{ value: "consistent", probability: 0.125 }, { value: "conflicts", probability: 0.5 }, { value: "outside", probability: 0.375 }],
    });
  });

  it("never turns a partial distribution into a confident zero for the missing values", async () => {
    const [answer] = await emulate("consistent", [{ value: "consistent", probability: 0.3 }]);
    expect(answer).toEqual({ type: "choice", name: "label", choice: "consistent", confidence: 0.7, probabilities: [{ value: "consistent", probability: 0.7 }] });
  });

  it("ignores distributions with duplicate, unknown or out-of-range entries", async () => {
    const bad = [
      [{ value: "consistent", probability: 0.5 }, { value: "consistent", probability: 0.3 }, { value: "outside", probability: 0.2 }],
      [{ value: "consistent", probability: 0.5 }, { value: "conflicts", probability: 0.3 }, { value: "maybe", probability: 0.2 }],
      [{ value: "consistent", probability: 1.5 }, { value: "conflicts", probability: 0.3 }, { value: "outside", probability: 0.2 }],
    ];
    for (const distribution of bad) {
      const [answer] = await emulate("outside", distribution);
      expect(answer).toEqual({ type: "choice", name: "label", choice: "outside", confidence: 0.7, probabilities: [{ value: "outside", probability: 0.7 }] });
    }
  });

  it("refuses when neither a usable distribution nor an allowed choice was reported", async () => {
    expect(await emulate("maybe", [{ value: "consistent", probability: 1 }])).toEqual([{ type: "refusal", name: "label" }]);
  });
});
