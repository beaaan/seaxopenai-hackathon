import type { Dimension, LevelChoice } from "../shared/schema";

interface LevelPair {
  left: number;
  right: number;
  leftLevel: number;
  rightLevel: number;
  key: number;
}

/** mulberry32, matching the seeded generator used by the fixture builder. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded AETG-style greedy selection; minRows is a floor, never a coverage cap. */
export function coveringArray(dimensions: Dimension[], minRows: number, seed: number): LevelChoice[][] {
  if (!Number.isInteger(minRows) || minRows < 0) throw new Error("minRows must be a nonnegative integer");
  const ids = new Set<string>();
  for (const dimension of dimensions) {
    if (ids.has(dimension.id)) throw new Error(`Duplicate dimension id: ${dimension.id}`);
    ids.add(dimension.id);
    if (dimension.levels.length === 0) throw new Error(`Dimension ${dimension.id} has no levels`);
    if (new Set(dimension.levels.map((level) => level.id)).size !== dimension.levels.length) {
      throw new Error(`Duplicate level id in dimension ${dimension.id}`);
    }
  }
  const random = prng(seed);
  const levelCounts = dimensions.map((dimension) => dimension.levels.length);
  const offsets: number[][] = dimensions.map(() => []);
  let nextKey = 0;
  let uncovered: LevelPair[] = [];
  for (let left = 0; left < dimensions.length; left++) {
    for (let right = left + 1; right < dimensions.length; right++) {
      offsets[left]![right] = nextKey;
      for (let leftLevel = 0; leftLevel < levelCounts[left]!; leftLevel++) {
        for (let rightLevel = 0; rightLevel < levelCounts[right]!; rightLevel++) {
          uncovered.push({ left, right, leftLevel, rightLevel, key: nextKey++ });
        }
      }
    }
  }
  const uncoveredKeys = new Set(uncovered.map((pair) => pair.key));
  const rows: number[][] = [];
  while (uncovered.length > 0) {
    let bestRow: number[] = [];
    let bestScore = -1;
    // Every candidate contains an uncovered pair, guaranteeing progress even at the tail.
    for (let attempt = 0; attempt < 40; attempt++) {
      const pair = uncovered[Math.floor(random() * uncovered.length)]!;
      const row = new Array<number>(dimensions.length).fill(-1);
      row[pair.left] = pair.leftLevel;
      row[pair.right] = pair.rightLevel;
      const order = dimensions.map((_, index) => index).filter((index) => row[index] === -1);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j]!, order[i]!];
      }
      for (const dimensionIndex of order) {
        let bestLevel = 0;
        let bestGain = -1;
        let ties = 0;
        for (let level = 0; level < levelCounts[dimensionIndex]!; level++) {
          let gain = 0;
          for (let other = 0; other < row.length; other++) {
            if (row[other] === -1 || other === dimensionIndex) continue;
            const left = Math.min(dimensionIndex, other);
            const right = Math.max(dimensionIndex, other);
            const leftLevel = left === dimensionIndex ? level : row[left]!;
            const rightLevel = right === dimensionIndex ? level : row[right]!;
            if (uncoveredKeys.has(offsets[left]![right]! + leftLevel * levelCounts[right]! + rightLevel)) gain++;
          }
          if (gain > bestGain) {
            bestGain = gain;
            bestLevel = level;
            ties = 1;
          } else if (gain === bestGain && random() < 1 / ++ties) bestLevel = level;
        }
        row[dimensionIndex] = bestLevel;
      }
      let score = 0;
      for (const remaining of uncovered) {
        if (row[remaining.left] === remaining.leftLevel && row[remaining.right] === remaining.rightLevel) score++;
      }
      if (score > bestScore) {
        bestRow = row;
        bestScore = score;
      }
    }
    rows.push(bestRow);
    uncovered = uncovered.filter((pair) => {
      const covered = bestRow[pair.left] === pair.leftLevel && bestRow[pair.right] === pair.rightLevel;
      if (covered) uncoveredKeys.delete(pair.key);
      return !covered;
    });
  }
  while (rows.length < minRows) rows.push(levelCounts.map((count) => Math.floor(random() * count)));
  return rows.map((row) => row.map((levelIndex, dimensionIndex) => ({
    dimId: dimensions[dimensionIndex]!.id,
    levelId: dimensions[dimensionIndex]!.levels[levelIndex]!.id,
  })));
}
