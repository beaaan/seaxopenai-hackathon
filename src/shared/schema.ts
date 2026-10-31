/**
 * Domain contracts shared by the pipeline, the server and the web UI.
 *
 * Owned by the integration owner (P1). Change only with a heads-up to the team:
 * every event in runs/*.jsonl is validated against these schemas.
 *
 * Conventions:
 * - `strictObject` everywhere; optional data is `nullable`, never `optional`
 *   (keeps every schema usable as an LLM structured-output schema).
 * - Arrays of `{key, value}` pairs instead of records, for the same reason.
 * - Vietnamese text fields end in `Vi`; English analysis glosses end in `En`.
 */
import { z } from "zod";
import { ActionEnum } from "./actions";

// ---------------------------------------------------------------------------
// Policy

/** One user-facing rendering of the rule: help article, checkout line, notification, ... */
export const Surface = z.strictObject({
  id: z.string(),
  label: z.string(),
  text: z.string(),
});
export type Surface = z.infer<typeof Surface>;

/** `policies/<id>/policy.json`: what gets tested. The first surface is the primary text. */
export const PolicyPackage = z.strictObject({
  id: z.string(),
  title: z.string(),
  lang: z.literal("vi"),
  sourceUrls: z.array(z.string()),
  retrievedAt: z.string(),
  surfaces: z.array(Surface).min(1),
  notes: z.string().nullable(),
});
export type PolicyPackage = z.infer<typeof PolicyPackage>;

/** Sentence ids are `<surfaceId>.<n>` (1-based), produced by `splitSentences`. */
export const Sentence = z.strictObject({
  id: z.string(),
  surfaceId: z.string(),
  text: z.string(),
});
export type Sentence = z.infer<typeof Sentence>;

/** A concrete text under test. Version 0 is the package as published; rewrites bump it. */
export const PolicyVersion = z.strictObject({
  policyId: z.string(),
  version: z.number().int().nonnegative(),
  parentVersion: z.number().int().nonnegative().nullable(),
  surfaces: z.array(Surface).min(1),
  sentences: z.array(Sentence),
});
export type PolicyVersion = z.infer<typeof PolicyVersion>;

// ---------------------------------------------------------------------------
// Reference (human-written; visible to grader/judge) and holdout (scorer only)

export const FindingClass = z.enum(["wording_fix", "design_gap", "unresolvable"]);
export type FindingClass = z.infer<typeof FindingClass>;

export const Fact = z.strictObject({
  id: z.string(), // F1, F2, ...
  text: z.string(),
  sentenceIds: z.array(z.string()), // sentences of version 0 that state it; empty if from a related source
  source: z.string().nullable(), // URL when the fact comes from a related official page
});
export type Fact = z.infer<typeof Fact>;

export const NotCovered = z.strictObject({
  id: z.string(), // N1, N2, ...
  text: z.string(),
});
export type NotCovered = z.infer<typeof NotCovered>;

export const CorrectReading = z.strictObject({
  id: z.string(), // C1, C2, ...
  question: z.string(),
  answer: z.string(),
  factIds: z.array(z.string()),
});
export type CorrectReading = z.infer<typeof CorrectReading>;

/** `policies/<id>/reference.json` */
export const Reference = z.strictObject({
  policyId: z.string(),
  author: z.string(),
  facts: z.array(Fact),
  notCovered: z.array(NotCovered),
  correctReadings: z.array(CorrectReading),
});
export type Reference = z.infer<typeof Reference>;

export const EdgeCase = z.strictObject({
  id: z.string(), // H1, H2, ...
  description: z.string(),
  sentenceIds: z.array(z.string()),
  expectedClass: FindingClass,
});
export type EdgeCase = z.infer<typeof EdgeCase>;

/** The policy's holdout file: read ONLY by src/eval (enforced by `npm run guard`). */
export const Holdout = z.strictObject({
  policyId: z.string(),
  author: z.string(),
  edgeCases: z.array(EdgeCase),
});
export type Holdout = z.infer<typeof Holdout>;

/** A version of the rule that circulates outside the official text; used as a reader's prior belief. */
export const FolkVersion = z.strictObject({
  id: z.string(),
  textVi: z.string(), // verbatim
  claimEn: z.string(), // what it asserts, in one line
  source: z.string(),
  date: z.string().nullable(),
});
export type FolkVersion = z.infer<typeof FolkVersion>;

/** `policies/<id>/folk.json` */
export const FolkFile = z.strictObject({
  policyId: z.string(),
  versions: z.array(FolkVersion),
});
export type FolkFile = z.infer<typeof FolkFile>;

// ---------------------------------------------------------------------------
// Scenarios

export const Level = z.strictObject({
  id: z.string(),
  label: z.string(),
  description: z.string(),
});
export type Level = z.infer<typeof Level>;

export const Dimension = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  levels: z.array(Level).min(2),
  origin: z.enum(["extracted", "human", "reviewer"]),
  rationale: z.string(),
});
export type Dimension = z.infer<typeof Dimension>;

export const LevelChoice = z.strictObject({
  dimId: z.string(),
  levelId: z.string(),
});
export type LevelChoice = z.infer<typeof LevelChoice>;

export const Persona = z.strictObject({
  name: z.string(),
  age: z.number().int(),
  province: z.string(),
  occupation: z.string(),
  literacy: z.enum(["low", "medium", "high"]),
  paymentInstruments: z.array(z.string()),
  accountSharing: z.string(),
  history: z.string(),
});
export type Persona = z.infer<typeof Persona>;

/** What the reader actually sees, and how. */
export const Exposure = z.strictObject({
  surfaceIds: z.array(z.string()), // surfaces shown; empty when only a folk version reaches them
  folkVersionId: z.string().nullable(), // prior belief / friend's paraphrase
  attention: z.enum(["skim", "careful"]),
});
export type Exposure = z.infer<typeof Exposure>;

export const Scenario = z.strictObject({
  id: z.string(),
  policyId: z.string(),
  batch: z.number().int().nonnegative(),
  origin: z.enum(["seed", "adaptive", "smoke", "human"]),
  levels: z.array(LevelChoice),
  persona: Persona,
  exposure: Exposure,
  situationVi: z.string(),
  allocationReason: z.string().nullable(),
});
export type Scenario = z.infer<typeof Scenario>;

// ---------------------------------------------------------------------------
// Readings

/** Atom: one interpretation of one quoted piece of text. */
export const Interpretation = z.strictObject({
  id: z.string(),
  quote: z.string(),
  sentenceId: z.string().nullable(), // null: about something the text does not say
  meaningVi: z.string(),
  glossEn: z.string(),
  confidence: z.number().min(0).max(1),
});
export type Interpretation = z.infer<typeof Interpretation>;

export const OpenQuestion = z.strictObject({
  id: z.string(),
  quote: z.string().nullable(),
  questionVi: z.string(),
  glossEn: z.string(),
});
export type OpenQuestion = z.infer<typeof OpenQuestion>;

export const IntendedAction = z.strictObject({
  action: ActionEnum,
  detailVi: z.string(),
});
export type IntendedAction = z.infer<typeof IntendedAction>;

export const Reading = z.strictObject({
  id: z.string(),
  scenarioId: z.string(),
  policyId: z.string(),
  policyVersion: z.number().int().nonnegative(),
  model: z.string(),
  paraphraseVi: z.string(),
  interpretations: z.array(Interpretation),
  questions: z.array(OpenQuestion),
  actions: z.array(IntendedAction),
  feelingVi: z.string(),
});
export type Reading = z.infer<typeof Reading>;

export const GradeLabel = z.enum(["consistent", "conflicts", "outside", "unclear"]);
export type GradeLabel = z.infer<typeof GradeLabel>;

/**
 * Grade of one interpretation against reference facts (never against the holdout).
 * Produced by the Decisions API: `label` is the top choice, `confidence` its probability.
 */
export const Grade = z.strictObject({
  readingId: z.string(),
  interpretationId: z.string(),
  label: GradeLabel,
  confidence: z.number().min(0).max(1),
  factIds: z.array(z.string()),
  why: z.string().nullable(), // null when graded by Decisions (no rationale is generated)
});
export type Grade = z.infer<typeof Grade>;

/**
 * Codebook coding: probability that a reading holds the belief described by a cluster
 * label (Decisions predicate). The same codebook is applied to every policy version, so
 * before/after metrics compare like with like.
 */
export const Coding = z.strictObject({
  readingId: z.string(),
  clusterId: z.string(),
  probability: z.number().min(0).max(1),
});
export type Coding = z.infer<typeof Coding>;

// ---------------------------------------------------------------------------
// Clusters, allocation, findings

export const Cluster = z.strictObject({
  id: z.string(),
  policyVersion: z.number().int().nonnegative(),
  sentenceId: z.string().nullable(), // null: "rule not in text"
  interpretationIds: z.array(z.string()),
  readingIds: z.array(z.string()),
  labelEn: z.string(),
  labelVi: z.string(),
  conflictShare: z.number().min(0).max(1),
});
export type Cluster = z.infer<typeof Cluster>;

export const LevelShare = z.strictObject({
  levelId: z.string(),
  n: z.number().int().nonnegative(),
  conflictShare: z.number().min(0).max(1),
});
export type LevelShare = z.infer<typeof LevelShare>;

export const SplitRow = z.strictObject({
  dimId: z.string(),
  nmi: z.number(),
  z: z.number(), // permutation z-score
  byLevel: z.array(LevelShare),
});
export type SplitRow = z.infer<typeof SplitRow>;

export const DiscoveryPoint = z.strictObject({
  batch: z.number().int().nonnegative(),
  readings: z.number().int().nonnegative(), // cumulative
  newClusters: z.number().int().nonnegative(),
});
export type DiscoveryPoint = z.infer<typeof DiscoveryPoint>;

export const AllocationDecision = z.strictObject({
  batch: z.number().int().nonnegative(), // batch being allocated
  split: z.array(SplitRow),
  discovery: z.array(DiscoveryPoint),
  focusDimIds: z.array(z.string()),
  newLevels: z.array(z.strictObject({ dimId: z.string(), level: Level })),
  n: z.number().int().nonnegative(),
  stopExploring: z.boolean(),
  rationale: z.string(),
  decidedBy: z.enum(["reviewer", "fallback"]),
});
export type AllocationDecision = z.infer<typeof AllocationDecision>;

export const FactCheck = z.strictObject({
  factId: z.string(),
  entailed: z.boolean(),
  why: z.string(),
});
export type FactCheck = z.infer<typeof FactCheck>;

export const FidelityResult = z.strictObject({
  passed: z.boolean(),
  facts: z.array(FactCheck),
  newCommitments: z.array(z.string()),
  requiresNewFact: z
    .strictObject({
      text: z.string(),
      kind: z.enum(["changes_rule", "missing_info"]),
    })
    .nullable(),
});
export type FidelityResult = z.infer<typeof FidelityResult>;

export const RepairAttempt = z.strictObject({
  targetSentenceIds: z.array(z.string()),
  rewriteVi: z.string(),
  fidelity: FidelityResult,
});
export type RepairAttempt = z.infer<typeof RepairAttempt>;

export const Finding = z.strictObject({
  id: z.string(),
  title: z.string(),
  sentenceIds: z.array(z.string()),
  readingSummary: z.string(),
  plausibility: z.string(),
  dimsAssociated: z.array(z.string()),
  conflictsReference: z.boolean(),
  factIds: z.array(z.string()),
  class: FindingClass,
  classRationale: z.string(),
  repair: RepairAttempt.nullable(),
  evidence: z.strictObject({
    clusterIds: z.array(z.string()),
    scenarioIds: z.array(z.string()),
    readingIds: z.array(z.string()),
  }),
});
export type Finding = z.infer<typeof Finding>;

// ---------------------------------------------------------------------------
// Rewrite loop

export const Edit = z.strictObject({
  sentenceIds: z.array(z.string()), // sentences of fromVersion replaced (empty = insertion)
  before: z.string(),
  after: z.string(),
  findingIds: z.array(z.string()),
});
export type Edit = z.infer<typeof Edit>;

export const Rewrite = z.strictObject({
  fromVersion: z.number().int().nonnegative(),
  toVersion: z.number().int().nonnegative(),
  edits: z.array(Edit),
  fidelity: FidelityResult,
});
export type Rewrite = z.infer<typeof Rewrite>;

export const Interval = z.strictObject({ lo: z.number(), hi: z.number() });
export type Interval = z.infer<typeof Interval>;

export const Iteration = z.strictObject({
  policyVersion: z.number().int().nonnegative(),
  readings: z.number().int().nonnegative(),
  conflictRate: z.number().min(0).max(1),
  ci95: Interval,
  openQuestionRate: z.number().min(0).max(1),
  openWordingFindings: z.number().int().nonnegative(),
  findingReproduction: z.array(z.strictObject({ findingId: z.string(), rate: z.number().min(0).max(1) })),
  noiseBand: z.number().nullable(),
  decision: z.enum(["continue", "stop"]),
  reason: z.string(),
});
export type Iteration = z.infer<typeof Iteration>;

// ---------------------------------------------------------------------------
// Evaluation

export const BaselineIssue = z.strictObject({
  id: z.string(),
  sentenceQuote: z.string(),
  issue: z.string(),
  why: z.string(),
});
export type BaselineIssue = z.infer<typeof BaselineIssue>;

export const BaselineRun = z.strictObject({
  id: z.string(),
  model: z.string(),
  effort: z.string(),
  issues: z.array(BaselineIssue),
});
export type BaselineRun = z.infer<typeof BaselineRun>;

export const ScoreMatch = z.strictObject({
  edgeCaseId: z.string(),
  systemId: z.string(),
  matched: z.boolean(),
  itemId: z.string().nullable(), // finding id or baseline issue id
  why: z.string(),
});
export type ScoreMatch = z.infer<typeof ScoreMatch>;

export const Score = z.strictObject({
  systems: z.array(z.strictObject({ id: z.string(), label: z.string(), recall: z.number().min(0).max(1) })),
  matches: z.array(ScoreMatch),
  outsideReference: z.array(z.strictObject({ systemId: z.string(), itemId: z.string() })),
});
export type Score = z.infer<typeof Score>;

export const HumanQuestion = z.strictObject({
  id: z.string(),
  questionVi: z.string(),
  findingIds: z.array(z.string()),
});
export type HumanQuestion = z.infer<typeof HumanQuestion>;

export const HumanAnswer = z.strictObject({
  id: z.string(),
  respondent: z.string(),
  questionId: z.string(),
  answerVi: z.string(),
});
export type HumanAnswer = z.infer<typeof HumanAnswer>;

export const HumanMapping = z.strictObject({
  answerId: z.string(),
  findingId: z.string().nullable(),
  why: z.string(),
});
export type HumanMapping = z.infer<typeof HumanMapping>;

// ---------------------------------------------------------------------------
// Runs

export const RunConfig = z.strictObject({
  policyId: z.string(),
  budget: z.number().int().positive(), // total readings for exploration
  seedSize: z.number().int().positive(),
  batchSize: z.number().int().positive(),
  maxIterations: z.number().int().nonnegative(),
  models: z.strictObject({
    reader: z.string(),
    judge: z.string(),
    grader: z.string(),
    reviewer: z.string(),
  }),
  fresh: z.boolean(), // bypass the LLM cache
});
export type RunConfig = z.infer<typeof RunConfig>;

/** Normalised Codex App Server / Responses item, shown in the thread inspector. */
export const ThreadItemRecord = z.strictObject({
  threadId: z.string(),
  role: z.enum(["reviewer", "hero", "probe"]),
  label: z.string(),
  backend: z.enum(["appserver", "responses"]),
  itemType: z.string(), // agentMessage | reasoning | dynamicToolCall | userMessage | ...
  item: z.unknown(), // raw item JSON
});
export type ThreadItemRecord = z.infer<typeof ThreadItemRecord>;
