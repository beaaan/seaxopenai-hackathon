import { describe, expect, it } from "vitest";
import { agglomerate } from "../src/reviewer/cluster";

describe("agglomerate", () => {
  it("separates distant blobs while grouping nearby directions regardless of magnitude", () => {
    const vectors = [[1, 0], [10, 0.2], [-1, 0], [-10, -0.2], [0, 1]];
    expect(agglomerate(vectors, 0.25)).toEqual([[0, 1], [2, 3], [4]]);
  });

  it("includes the exact threshold boundary but not a distance just above it", () => {
    const orthogonal = [[1, 0], [0, 1]];
    expect(agglomerate(orthogonal, 1)).toEqual([[0, 1]]);
    expect(agglomerate(orthogonal, 1 - Number.EPSILON)).toEqual([[0], [1]]);
    expect(agglomerate([[1, 0], [2, 0]], 0)).toEqual([[0, 1]]);
  });

  it("uses average linkage rather than chaining through the nearest pair", () => {
    const vectors = [[1, 0], [Math.sqrt(3) / 2, 0.5], [0.5, Math.sqrt(3) / 2]];
    expect(agglomerate(vectors, 0.2)).toEqual([[0, 1], [2]]);
  });

  it("weights linkage by member counts after unequal-sized groups merge", () => {
    const at = (degrees: number) => [Math.cos(degrees * Math.PI / 180), Math.sin(degrees * Math.PI / 180)];
    // Three identical observations at 0 degrees pull the average closer to 0 than
    // the equally weighted cluster-centroid shortcut would after absorbing 30 degrees.
    const vectors = [at(0), at(0), at(0), at(30), at(60)];
    expect(agglomerate(vectors, 0.35)).toEqual([[0, 1, 2, 3], [4]]);
  });

  it("handles empty input, a singleton and isolated singletons", () => {
    expect(agglomerate([], 0.25)).toEqual([]);
    expect(agglomerate([[2, 3]], 0.25)).toEqual([[0]]);
    expect(agglomerate([[1, 0], [0, 1], [-1, 0]], 0.25)).toEqual([[0], [1], [2]]);
  });

  it("resolves equal-distance ties deterministically without changing its input", () => {
    const vectors = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    const original = vectors.map((vector) => [...vector]);
    for (let repetition = 0; repetition < 5; repetition++) {
      expect(agglomerate(vectors, 1)).toEqual([[0, 1], [2, 3]]);
    }
    expect(vectors).toEqual(original);
  });

  it("treats zero vectors as directionless instead of producing NaN distances", () => {
    expect(agglomerate([[0, 0], [0, 0], [1, 0]], 0.25)).toEqual([[0], [1], [2]]);
    expect(agglomerate([[0, 0], [1, 0]], 1)).toEqual([[0, 1]]);
  });

  it("rejects invalid distances and incompatible vector coordinates", () => {
    expect(() => agglomerate([[1]], -1)).toThrow(RangeError);
    expect(() => agglomerate([[1]], NaN)).toThrow(RangeError);
    expect(() => agglomerate([[1], [1, 2]], 0.25)).toThrow(/equally sized/);
    expect(() => agglomerate([[]], 0.25)).toThrow(/nonempty/);
    expect(() => agglomerate([[Infinity]], 0.25)).toThrow(/finite/);
  });
});
