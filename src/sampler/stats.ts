import type { Cluster, Coding, Dimension, DiscoveryPoint, Grade, Reading, Scenario, SplitRow } from "../shared/schema";
import { trigramSimilarity } from "./anchor";

interface BinaryFeature {
  probabilities: number[];
  entropy: number;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function entropy(probabilities: Iterable<number>): number {
  let result = 0;
  for (const probability of probabilities) {
    if (probability > 0) result -= probability * Math.log(probability);
  }
  return result;
}

function binaryFeature(probabilities: number[]): BinaryFeature {
  const mean = probabilities.length === 0 ? 0 : probabilities.reduce((sum, p) => sum + p, 0) / probabilities.length;
  return { probabilities, entropy: entropy([mean, 1 - mean]) };
}

/** Each belief/action is a binary variable; soft probabilities contribute expected counts. */
function weightedNmi(labels: number[], levelCounts: number[], features: BinaryFeature[]): number {
  if (labels.length === 0) return 0;
  const n = labels.length;
  const levelEntropy = entropy(levelCounts.map((count) => count / n));
  if (levelEntropy === 0) return 0;
  let weighted = 0;
  let weight = 0;
  for (const feature of features) {
    if (feature.entropy === 0) continue;
    const present = new Array<number>(levelCounts.length).fill(0);
    for (let i = 0; i < n; i++) {
      const label = labels[i];
      if (label !== undefined) present[label] = (present[label] ?? 0) + (feature.probabilities[i] ?? 0);
    }
    const marginal = present.reduce((sum, count) => sum + count, 0) / n;
    let information = 0;
    for (let level = 0; level < levelCounts.length; level++) {
      const count = levelCounts[level] ?? 0;
      if (count === 0) continue;
      const yes = present[level] ?? 0;
      const no = count - yes;
      if (yes > 0 && marginal > 0) information += (yes / n) * Math.log(yes / (count * marginal));
      if (no > 0 && marginal < 1) information += (no / n) * Math.log(no / (count * (1 - marginal)));
    }
    const nmi = Math.max(0, Math.min(1, information / Math.min(levelEntropy, feature.entropy)));
    weighted += feature.entropy * nmi;
    weight += feature.entropy;
  }
  return weight === 0 ? 0 : weighted / weight;
}

export function splitTable(args: {
  dimensions: Dimension[];
  scenarios: Scenario[];
  readings: Reading[];
  grades: Grade[];
  codings: Coding[];
  threshold: number;
  permutations: number;
  seed: number;
}): SplitRow[] {
  const scenarios = new Map(args.scenarios.map((scenario) => [scenario.id, scenario]));
  const conflicts = new Set(args.grades.filter((grade) => grade.label === "conflicts" && grade.confidence >= args.threshold).map((grade) => grade.readingId));
  const codingByReading = new Map<string, Map<string, number>>();
  for (const coding of args.codings) {
    let beliefs = codingByReading.get(coding.readingId);
    if (!beliefs) {
      beliefs = new Map();
      codingByReading.set(coding.readingId, beliefs);
    }
    beliefs.set(coding.clusterId, coding.probability);
  }
  const random = mulberry32(args.seed);
  return args.dimensions.map((dimension) => {
    const selected: Array<{ reading: Reading; levelId: string }> = [];
    for (const reading of args.readings) {
      const choice = scenarios.get(reading.scenarioId)?.levels.find((level) => level.dimId === dimension.id);
      if (choice) selected.push({ reading, levelId: choice.levelId });
    }
    const levelIds = [...new Set([...dimension.levels.map((level) => level.id), ...selected.map((item) => item.levelId)])];
    const levelIndex = new Map(levelIds.map((id, index) => [id, index]));
    const labels = selected.map((item) => levelIndex.get(item.levelId) ?? 0);
    const counts = new Array<number>(levelIds.length).fill(0);
    const conflictCounts = new Array<number>(levelIds.length).fill(0);
    for (let i = 0; i < selected.length; i++) {
      const label = labels[i] ?? 0;
      counts[label] = (counts[label] ?? 0) + 1;
      const item = selected[i];
      if (item && conflicts.has(item.reading.id)) conflictCounts[label] = (conflictCounts[label] ?? 0) + 1;
    }
    const clusterIds = new Set(selected.flatMap(({ reading }) => [...(codingByReading.get(reading.id)?.keys() ?? [])]));
    const beliefs = [...clusterIds].map((clusterId) => binaryFeature(selected.map(({ reading }) => codingByReading.get(reading.id)?.get(clusterId) ?? 0)));
    const actionsByReading = selected.map(({ reading }) => new Set(reading.actions.map((action) => action.action)));
    const actionIds = new Set(actionsByReading.flatMap((actions) => [...actions]));
    const actions = [...actionIds].map((actionId) => binaryFeature(actionsByReading.map((set) => (set.has(actionId) ? 1 : 0))));
    // Belief and intended-action channels each contribute an entropy-weighted NMI (0..1).
    const measure = (levels: number[]): number => weightedNmi(levels, counts, beliefs) + weightedNmi(levels, counts, actions);
    const nmi = measure(labels);
    let mean = 0;
    let squaredDeviations = 0;
    const permutations = Math.max(0, Math.floor(args.permutations));
    for (let permutation = 0; permutation < permutations; permutation++) {
      const shuffled = [...labels];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const left = shuffled[i] ?? 0;
        shuffled[i] = shuffled[j] ?? 0;
        shuffled[j] = left;
      }
      const value = measure(shuffled);
      const delta = value - mean;
      mean += delta / (permutation + 1);
      squaredDeviations += delta * (value - mean);
    }
    const sd = permutations === 0 ? 0 : Math.sqrt(Math.max(0, squaredDeviations / permutations));
    return {
      dimId: dimension.id,
      nmi,
      z: sd === 0 ? 0 : (nmi - mean) / sd,
      byLevel: levelIds.map((levelId, index) => ({
        levelId,
        n: counts[index] ?? 0,
        conflictShare: (counts[index] ?? 0) === 0 ? 0 : (conflictCounts[index] ?? 0) / (counts[index] ?? 1),
      })),
    };
  });
}

export function discoveryCurve(batches: Array<{ batch: number; readingsSoFar: number; clusters: Cluster[] }>): DiscoveryPoint[] {
  const ordered = [...batches].sort((a, b) => a.batch - b.batch);
  let previous: Array<{ sentenceId: string | null; members: Set<string>; discovered: boolean }> = [];
  return ordered.map((point) => {
    const existing = new Set(previous.flatMap((cluster) => [...cluster.members]));
    let newClusters = 0;
    const current = point.clusters.map((cluster) => {
      const members = new Set(cluster.readingIds);
      const oldMembers = [...members].filter((id) => existing.has(id));
      // Re-clustering renames ids: identity is >=50% OLD-reader overlap within the same sentence.
      const previouslyDiscovered = oldMembers.length > 0 && previous.some((prior) =>
        prior.sentenceId === cluster.sentenceId && prior.discovered &&
        oldMembers.filter((id) => prior.members.has(id)).length / oldMembers.length >= 0.5,
      );
      const qualifies = members.size >= 2;
      if (qualifies && !previouslyDiscovered) newClusters++;
      // Preserve discovery through singleton descendants; an unseen singleton counts only on growing to two readers.
      return { sentenceId: cluster.sentenceId, members, discovered: qualifies || previouslyDiscovered };
    });
    previous = current;
    return { batch: point.batch, readings: point.readingsSoFar, newClusters };
  });
}

export function homogeneity(readings: Reading[]): number {
  if (readings.length < 2) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < readings.length; i++) {
    const left = readings[i];
    if (!left) continue;
    for (let j = i + 1; j < readings.length; j++) {
      const right = readings[j];
      if (!right) continue;
      total += trigramSimilarity(left.paraphraseVi, right.paraphraseVi);
      pairs++;
    }
  }
  return total / pairs;
}
