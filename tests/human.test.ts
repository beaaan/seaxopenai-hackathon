import { describe, expect, it } from "vitest";
import { selectHumanFinding } from "../src/eval/human";
import type { Finding } from "../src/shared/schema";

function finding(id: string, clusterIds: string[]): Finding {
  return { id, title: id, sentenceIds: [], readingSummary: id, plausibility: "", dimsAssociated: [], conflictsReference: true, factIds: [], class: "wording_fix", classRationale: "", repair: null, evidence: { clusterIds, scenarioIds: [], readingIds: [] } };
}

describe("selectHumanFinding", () => {
  it("accepts the inclusive 0.5 boundary and otherwise returns no finding", () => {
    const findings = [finding("f1", ["c1"])];
    expect(selectHumanFinding(findings, [{ clusterId: "c1", probability: 0.49 }]).findingId).toBeNull();
    expect(selectHumanFinding(findings, [{ clusterId: "c1", probability: 0.5 }])).toEqual({ findingId: "f1", why: "c1: p=0.50" });
    expect(selectHumanFinding(findings, [{ clusterId: "unrelated", probability: 0.99 }]).findingId).toBeNull();
  });

  it("selects the strongest associated belief and breaks ties in finding order", () => {
    const findings = [finding("f1", ["c1", "c2"]), finding("f2", ["c3"])];
    const beliefs = [{ clusterId: "c1", probability: 0.6 }, { clusterId: "c2", probability: 0.9 }, { clusterId: "c3", probability: 0.8 }];
    expect(selectHumanFinding(findings, beliefs)).toEqual({ findingId: "f1", why: "c2: p=0.90, c3: p=0.80, c1: p=0.60" });
    expect(selectHumanFinding(findings, [{ clusterId: "c2", probability: 0.8 }, { clusterId: "c3", probability: 0.8 }]).findingId).toBe("f1");
  });

  it("does not manufacture zero probabilities for missing or refused beliefs", () => {
    const findings = [finding("f1", ["missing"]), finding("f2", ["observed"])];
    expect(selectHumanFinding(findings, [])).toEqual({ findingId: null, why: "no observed codebook beliefs" });
    expect(selectHumanFinding(findings, [{ clusterId: "observed", probability: 0.82 }])).toEqual({ findingId: "f2", why: "observed: p=0.82" });
  });
});
