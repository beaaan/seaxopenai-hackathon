import { makeVersion } from "../core/policy";
import type { StageContext } from "../pipeline/context";
import { readScenario } from "../sampler/reader";
import { Finding, type Cluster, type Coding, type FidelityResult, type FindingDraft, type PolicyVersion, type Reading, type Scenario } from "../shared/schema";
import { codeReadings } from "./code";
import { checkFidelity } from "./fidelity";
import { proposeRepair, type RepairProposal } from "./rewrite";

export interface RepairClassificationDeps {
  scenarios: Scenario[];
  codebook: Cluster[];
  /** Original cohort A and its codings against the frozen codebook. */
  readings: Reading[];
  codings: Coding[];
}

interface ResolutionCheck {
  before: number | null;
  after: number | null;
  resolved: boolean;
}

function meanScenarioBelief(
  scenarios: Scenario[],
  readings: Reading[],
  codings: Coding[],
  clusterIds: Set<string>,
): number | null {
  if (scenarios.length === 0 || clusterIds.size === 0) return null;
  const codingByReading = new Map<string, Map<string, number>>();
  for (const coding of codings) {
    if (!clusterIds.has(coding.clusterId)) continue;
    const beliefs = codingByReading.get(coding.readingId) ?? new Map<string, number>();
    beliefs.set(coding.clusterId, coding.probability);
    codingByReading.set(coding.readingId, beliefs);
  }
  let total = 0;
  for (const scenario of scenarios) {
    const matching = readings.filter((reading) => reading.scenarioId === scenario.id);
    if (matching.length === 0) return null;
    let maximum = 0;
    for (const reading of matching) {
      const beliefs = codingByReading.get(reading.id);
      if (!beliefs || beliefs.size !== clusterIds.size) return null;
      for (const probability of beliefs.values()) {
        if (!Number.isFinite(probability) || probability < 0 || probability > 1) return null;
        maximum = Math.max(maximum, probability);
      }
    }
    total += maximum;
  }
  return total / scenarios.length;
}

async function checkResolution(
  ctx: StageContext,
  version: PolicyVersion,
  draft: FindingDraft,
  proposal: RepairProposal,
  deps: RepairClassificationDeps,
): Promise<ResolutionCheck> {
  const evidenceScenarios = new Set(draft.evidence.scenarioIds);
  const scenarios = deps.scenarios.filter((scenario) => evidenceScenarios.has(scenario.id)).slice(0, 3);
  const evidenceClusters = new Set(draft.evidence.clusterIds);
  const codebook = deps.codebook.filter((cluster) => evidenceClusters.has(cluster.id));
  const clusterIds = new Set(codebook.map((cluster) => cluster.id));
  const before = meanScenarioBelief(scenarios, deps.readings, deps.codings, clusterIds);
  if (scenarios.length === 0 || codebook.length === 0 || clusterIds.size !== evidenceClusters.size) {
    return { before, after: null, resolved: false };
  }
  const repaired = makeVersion(version.policyId, version.version, version.version, proposal.surfaces);
  const freshCtx: StageContext = { ...ctx, config: { ...ctx.config, fresh: true } };
  const readings = await Promise.all(scenarios.map((scenario) => readScenario(freshCtx, {
    scenario,
    version: repaired,
    tag: `repair-${draft.id}`,
    fresh: true,
  })));
  const codings = await codeReadings(freshCtx, { readings, codebook });
  const after = meanScenarioBelief(scenarios, readings, codings, clusterIds);
  return { before, after, resolved: before !== null && after !== null && after < 0.5 };
}

export async function classifyByRepair(
  ctx: StageContext,
  version: PolicyVersion,
  draft: FindingDraft,
  deps: RepairClassificationDeps,
): Promise<Finding> {
  let proposal = await proposeRepair(ctx, version, draft);
  let resolutionEvidence = "";
  const anchors = draft.sentenceIds.length > 0 ? draft.sentenceIds.join(", ") : "the unstated rule";
  for (let attempt = 0; attempt < 2; attempt++) {
    const changed = proposal.surfaces.some((surface, index) => surface.text !== version.surfaces[index]?.text);
    const fidelity: FidelityResult = changed ? await checkFidelity(ctx, { original: version, candidate: proposal.surfaces }) : {
      passed: false,
      facts: [],
      newCommitments: [],
      requiresNewFact: proposal.requiresNewFact,
    };
    const repair = { targetSentenceIds: proposal.targetSentenceIds, rewriteVi: proposal.rewriteVi, fidelity };
    if (!proposal.canFixByWording) {
      const required = proposal.requiresNewFact!;
      return Finding.parse({
        ...draft,
        class: required.kind === "missing_info" ? "unresolvable" : "design_gap",
        classRationale: `A wording-only repair cannot resolve the reading at ${anchors}: ${required.text.replace(/[.!?]+(?:\s+|$)/g, "; ").replace(/;\s*$/, "")}. ${required.kind === "missing_info" ? "It needs information absent from the policy/reference" : "It would change a stated rule"}${resolutionEvidence ? `; ${resolutionEvidence}` : ""}.`,
        repair,
      });
    }
    if (!fidelity.passed) {
      const failures = fidelity.facts.filter((fact) => !fact.entailed).map((fact) => `${fact.factId}: ${fact.why}`);
      const evidence = [...failures, ...fidelity.newCommitments].join("; ") || "the attempted edit did not establish preservation";
      return Finding.parse({
        ...draft,
        class: fidelity.requiresNewFact?.kind === "missing_info" ? "unresolvable" : "design_gap",
        classRationale: `The attempted wording repair at ${anchors} failed the blind fidelity check: ${evidence.replace(/[.!?]+(?:\s+|$)/g, "; ").replace(/;\s*$/, "")}.${resolutionEvidence ? ` Targeted belief check: ${resolutionEvidence}.` : ""}`,
        repair,
      });
    }
    const resolution = await checkResolution(ctx, version, draft, proposal, deps);
    const before = resolution.before === null ? "unavailable" : resolution.before.toFixed(3);
    const after = resolution.after === null ? "unavailable" : resolution.after.toFixed(3);
    resolutionEvidence = `before/after mean maximum belief probability ${before}/${after}`;
    if (resolution.resolved) {
      return Finding.parse({
        ...draft,
        class: "wording_fix",
        classRationale: `The minimal edit at ${anchors} preserved all checked facts without new commitments. Targeted evidence-scenario re-reads were below the resolution threshold (${resolutionEvidence}; after < 0.5).`,
        repair,
      });
    }
    if (attempt === 1) {
      return Finding.parse({
        ...draft,
        class: "design_gap",
        classRationale: `Provisional: wording edits at ${anchors} preserved the facts but ${resolution.after === null || resolution.before === null ? "could not establish a change in readings because matching evidence or codings were unavailable" : "did not change readings enough to resolve the belief"}. The single retry remained unresolved (${resolutionEvidence}; required after < 0.5).`,
        repair,
      });
    }
    proposal = await proposeRepair(ctx, version, draft, JSON.stringify({
      reason: "The faithful wording edit did not resolve the targeted belief; make one different minimal attempt.",
      beforeMeanProbability: resolution.before,
      afterMeanProbability: resolution.after,
      resolutionThreshold: 0.5,
      previousRewriteVi: proposal.rewriteVi,
      previousSurfaces: proposal.surfaces,
    }));
  }
  throw new Error("Repair classification exhausted its two attempts without a result");
}
