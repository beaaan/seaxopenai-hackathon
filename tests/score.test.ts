import { describe, expect, it } from "vitest";
import { aggregateBaselines, summarizeScore } from "../src/eval/score";
import type { Score, ScoreMatch } from "../src/shared/schema";

function match(systemId: string, edgeCaseId: string, matched: boolean): ScoreMatch {
  return { systemId, edgeCaseId, matched, itemId: matched ? `${systemId}-item` : null, why: "comparison" };
}

describe("aggregateBaselines", () => {
  it("adds the mean recall and deduplicated union of baseline edge-case matches", () => {
    const score: Score = {
      systems: [
        { id: "wind-tunnel", label: "Wind Tunnel", recall: 1 },
        { id: "baseline-1", label: "First baseline", recall: 0.5 },
        { id: "baseline-2", label: "Second baseline", recall: 0.5 },
        { id: "another-system", label: "Not a baseline", recall: 1 },
      ],
      matches: [
        match("baseline-1", "e1", true), match("baseline-1", "e2", true), match("baseline-1", "e3", false), match("baseline-1", "e4", false),
        match("baseline-2", "e1", false), match("baseline-2", "e2", true), match("baseline-2", "e3", true), match("baseline-2", "e4", false),
        match("wind-tunnel", "e4", true), match("another-system", "e4", true),
      ],
      outsideReference: [{ systemId: "wind-tunnel", itemId: "unmatched" }],
    };
    const original = structuredClone(score);
    const result = aggregateBaselines(score);
    expect(result.systems.at(-2)).toEqual({ id: "baseline-mean", label: "Baseline mean", recall: 0.5 });
    expect(result.systems.at(-1)).toEqual({ id: "baseline-union", label: "Baseline union", recall: 0.75 });
    expect(result.matches).toEqual(score.matches);
    expect(result.outsideReference).toEqual(score.outsideReference);
    expect(score).toEqual(original);
    expect(aggregateBaselines(result)).toEqual(result);
  });

  it("aggregates numeric replicates only, leaving Astra separate", () => {
    const score: Score = {
      systems: [{ id: "baseline-1", label: "A", recall: 1 }, { id: "baseline-astra", label: "B", recall: 0 }],
      matches: [match("baseline-1", "e1", true), match("baseline-1", "e1", true), match("baseline-astra", "e1", false)],
      outsideReference: [],
    };
    const result = aggregateBaselines(score);
    expect(result.systems.find((system) => system.id === "baseline-mean")?.recall).toBe(1);
    expect(result.systems.find((system) => system.id === "baseline-union")?.recall).toBe(1);
    expect(result.systems.find((system) => system.id === "baseline-astra")).toEqual(score.systems[1]);
  });

  it("adds no aggregates without baseline systems", () => {
    const score: Score = { systems: [{ id: "wind-tunnel", label: "Wind Tunnel", recall: 0 }], matches: [], outsideReference: [] };
    expect(aggregateBaselines(score)).toEqual(score);
  });

  it("handles an empty edge-case set without dividing by zero", () => {
    const score: Score = { systems: [{ id: "baseline-1", label: "Baseline", recall: 0 }], matches: [], outsideReference: [] };
    expect(aggregateBaselines(score).systems.slice(1)).toEqual([
      { id: "baseline-mean", label: "Baseline mean", recall: 0 }, { id: "baseline-union", label: "Baseline union", recall: 0 },
    ]);
  });
});

describe("summarizeScore", () => {
  it("retains all item matches while counting each edge case only once", () => {
    const systems = [{ id: "wind-tunnel", label: "Wind Tunnel", items: [{ id: "f1", text: "first" }, { id: "f2", text: "second" }, { id: "f3", text: "unmatched" }] }];
    const matches: ScoreMatch[] = [
      { ...match("wind-tunnel", "e1", true), itemId: "f1" },
      { ...match("wind-tunnel", "e1", true), itemId: "f2" },
      { ...match("wind-tunnel", "e2", true), itemId: "f2" },
      match("wind-tunnel", "e3", false),
    ];
    const result = summarizeScore(systems, matches, 3);
    expect(result.systems[0]?.recall).toBe(2 / 3);
    expect(result.matches).toEqual(matches);
    expect(result.outsideReference).toEqual([{ systemId: "wind-tunnel", itemId: "f3" }]);
  });
});
