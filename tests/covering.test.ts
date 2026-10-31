import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { coveringArray } from "../src/sampler/covering";
import type { Dimension } from "../src/shared/schema";

function dimensionsFor(levelCounts: number[]): Dimension[] {
  return levelCounts.map((count, index) => ({
    id: `dim_${index}`,
    name: `Dimension ${index}`,
    description: "Test reader dimension",
    rationale: "Pair coverage must not depend on the number of levels",
    origin: "extracted",
    levels: Array.from({ length: count }, (_, level) => ({ id: `level_${level}`, label: `Level ${level}`, description: "A reader state" })),
  }));
}

const dimensionSets = fc.array(fc.integer({ min: 2, max: 4 }), { minLength: 2, maxLength: 8 }).map(dimensionsFor);

describe("coveringArray", () => {
  it("covers every pair of levels for random dimension sets", () => {
    fc.assert(fc.property(dimensionSets, fc.integer(), (dimensions, seed) => {
      const rows = coveringArray(dimensions, 0, seed);
      for (const row of rows) {
        expect(row.map((choice) => choice.dimId)).toEqual(dimensions.map((dimension) => dimension.id));
        for (const [index, choice] of row.entries()) {
          expect(dimensions[index]!.levels.some((level) => level.id === choice.levelId)).toBe(true);
        }
      }
      for (let left = 0; left < dimensions.length; left++) {
        for (let right = left + 1; right < dimensions.length; right++) {
          for (const leftLevel of dimensions[left]!.levels) {
            for (const rightLevel of dimensions[right]!.levels) {
              expect(rows.some((row) => row[left]!.levelId === leftLevel.id && row[right]!.levelId === rightLevel.id)).toBe(true);
            }
          }
        }
      }
    }), { numRuns: 75 });
  });

  it("treats minRows as a floor and never truncates required pair coverage", () => {
    const dimensions = dimensionsFor([4, 4]);
    expect(coveringArray(dimensions, 1, 7)).toHaveLength(16);
    fc.assert(fc.property(dimensionSets, fc.integer({ min: 0, max: 50 }), (set, minRows) => {
      expect(coveringArray(set, minRows, 7).length).toBeGreaterThanOrEqual(minRows);
    }), { numRuns: 30 });
  });

  it("is deterministic for the same seed", () => {
    fc.assert(fc.property(dimensionSets, fc.integer(), (dimensions, seed) => {
      expect(coveringArray(dimensions, 16, seed)).toEqual(coveringArray(dimensions, 16, seed));
    }), { numRuns: 30 });
  });

  it("handles zero or one dimension without introducing nonexistent levels", () => {
    expect(coveringArray([], 3, 7)).toEqual([[], [], []]);
    expect(coveringArray([], 0, 7)).toEqual([]);
    const dimensions = dimensionsFor([2]);
    const rows = coveringArray(dimensions, 5, 7);
    expect(rows).toHaveLength(5);
    for (const row of rows) expect(["level_0", "level_1"]).toContain(row[0]!.levelId);
  });

  it("rejects dimension definitions that cannot identify a valid row", () => {
    expect(() => coveringArray(dimensionsFor([0]), 1, 7)).toThrow("no levels");
    const duplicate = dimensionsFor([2, 2]);
    duplicate[1]!.id = duplicate[0]!.id;
    expect(() => coveringArray(duplicate, 1, 7)).toThrow("Duplicate dimension");
    expect(() => coveringArray([], -1, 7)).toThrow("minRows");
  });
});
