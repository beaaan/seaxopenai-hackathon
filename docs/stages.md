# Stage interfaces

Every stage is `async (ctx: StageContext, args) => result` (`src/pipeline/context.ts`). Stages return data. Only the orchestrator (`src/pipeline/run.ts`) appends domain events. Stages may call `ctx.emitThreadItem` and `ctx.log`.

Shared helpers:
- `policyText(version, {ids, surfaceIds?})`, `referenceText(reference)` from `src/pipeline/context.ts`.
- `prompt(name, vars)` from `src/core/prompts.ts` loads and renders `prompts/<name>.md`. It throws on missing or unused `{{vars}}`.
- `ctx.gateway.structured / decide / embed / agentThread / hasApiKey` from `src/core/llm/gateway.ts`.

Ids are deterministic so reruns line up:

| Kind | Id format |
|---|---|
| Scenario | `s001`… |
| Reading | `r-<scenarioId>-v<version>[-<tag>]` |
| Interpretation | `<readingId>.i<n>` |
| Question | `<readingId>.q<n>` |
| Cluster | `c-v<version>-<n>` |
| Finding | `f<n>` |

## src/sampler (P2)

```ts
// dims.ts: LLM (gpt-6.1-sol, medium) → 3–5 policy-specific dimensions (2–4 levels, snake_case ids), PLUS three
// built-in exposure dimensions added in code (generic for any policy):
//   exposure_channel: one level per policy surface id (level id = surface id) + "friend" if folk versions exist
//   prior_belief:     "none" + up to 3 folk version ids (level id = folk version id); omitted if no folk versions
//   attention:        "skim" | "careful"
// writeScenarios maps these three deterministically to Scenario.exposure.
extractDimensions(ctx, version: PolicyVersion): Promise<Dimension[]>

// covering.ts: pure, seeded; every pair of levels across two dimensions appears in ≥ 1 row; ≥ minRows rows
coveringArray(dimensions: Dimension[], minRows: number, seed: number): LevelChoice[][]

// scenarios.ts: one structured call per row (parallel) → persona + exposure + situationVi
//   exposure.surfaceIds ⊆ version surfaces; folkVersionId ∈ ctx.folk.versions or null
writeScenarios(ctx, args: { version: PolicyVersion; dimensions: Dimension[]; rows: LevelChoice[][]; batch: number;
  origin: Scenario["origin"]; allocationReason: string | null; firstIndex: number }): Promise<Scenario[]>

// reader.ts: reads ONLY the exposure; in character; returns an anchored Reading
readScenario(ctx, args: { scenario: Scenario; version: PolicyVersion; tag: string | null; fresh: boolean }): Promise<Reading>

// anchor.ts: trigram Jaccard ≥ 0.5 → sentence id; otherwise a Decisions choice over sentence ids + "none"
trigramSimilarity(a: string, b: string): number
// surfaceIds = what the reader was shown; a quote never anchors to an unseen sentence (empty ⇒ all null)
anchorQuotes(ctx, version: PolicyVersion, quotes: string[], surfaceIds: readonly string[]): Promise<Array<string | null>>

// stats.ts: pure, seeded
splitTable(args: { dimensions: Dimension[]; scenarios: Scenario[]; readings: Reading[]; grades: Grade[];
  codings: Coding[]; permutations: number; seed: number }): SplitRow[]
discoveryCurve(batches: Array<{ batch: number; readingsSoFar: number; clusters: Cluster[] }>): DiscoveryPoint[]
homogeneity(readings: Reading[]): number   // mean pairwise char-trigram Jaccard of paraphrases, 0..1

// allocate.ts: reviewer = persistent App Server agent thread (fallback: top two dims with z > 1, else top one)
createReviewer(ctx): Promise<Reviewer>
interface Reviewer {
  decide(args: { batch: number; remainingBudget: number; batchSize: number; dimensions: Dimension[]; split: SplitRow[];
    discovery: DiscoveryPoint[]; clusters: Cluster[]; readings: Reading[]; scenarios: Scenario[] }): Promise<AllocationDecision>;
  close(): Promise<void>;
}
rowsForDecision(dimensions: Dimension[], decision: AllocationDecision, seed: number): LevelChoice[][]  // n rows, ≥ 20% random
```

## src/reviewer (P3)

```ts
// grade.ts: Decisions; evidence = policyText(ids) + referenceText; data = the reading.
// Grade.label = the top choice, confidence = its probability, pConflicts = P(conflicts) from the distribution
// (null when unknown). Every metric uses the single predicate isConflict(grade, threshold).
gradeReadings(ctx, version: PolicyVersion, readings: Reading[]): Promise<Grade[]>
isConflict(grade: Grade, threshold: number): boolean

// cluster.ts: embeddings + average-linkage (cosine 0.25) per sentence (+ null-sentence group), then one LLM
// labelling pass per sentence whose labels are BELIEF STATEMENTS (VN + EN) usable as a codebook;
// without an API key: one LLM grouping call per sentence
// idPrefix: `c-v0-b<k>` for provisional exploration clusters, `cb0` for the frozen codebook, `c-v<i>` later
clusterInterpretations(ctx, args: { version: PolicyVersion; readings: Reading[]; grades: Grade[]; idPrefix: string }): Promise<Cluster[]>
agglomerate(vectors: number[][], maxDistance: number): number[][]   // pure; groups of indices

// code.ts: Decisions predicates, one per (reading, cluster); chunked by the gateway
codeReadings(ctx, args: { readings: Reading[]; codebook: Cluster[] }): Promise<Coding[]>

// findings.ts: judge (gpt-6.1-sol, high) → ≤ 10 drafts, merges clusters across sentences
draftFindings(ctx, args: { version: PolicyVersion; clusters: Cluster[]; readings: Reading[]; scenarios: Scenario[];
  grades: Grade[]; codings: Coding[]; dimensions: Dimension[]; split: SplitRow[] }): Promise<FindingDraft[]>

// rewrite.ts
proposeRepair(ctx, version: PolicyVersion, draft: FindingDraft): Promise<{ targetSentenceIds: string[]; rewriteVi: string; surfaces: Surface[] }>
rewritePolicy(ctx, args: { version: PolicyVersion; findings: Finding[]; nextVersion: number;
  feedback: FidelityResult | null; rejected: { surfaces: Surface[]; edits: Edit[] } | null }): Promise<{ surfaces: Surface[]; edits: Edit[] }>

// fidelity.ts: fresh, blind checker (does NOT see the finding)
// original is ALWAYS v0 (cumulative fidelity; reference fact sentence ids are v0 ids)
checkFidelity(ctx, args: { original: PolicyVersion; candidate: Surface[] }): Promise<FidelityResult>

// classify.ts: attempted repair → wording_fix | design_gap | unresolvable (+ repair evidence)
// fidelity passing proves preservation, not resolution: a passing repair is re-read on ≤ 3 evidence scenarios and coded
// against the draft's beliefs. before/after = mean over those scenarios of max P(belief) over the draft's clusters.
// reproduced ⇔ before ≥ 0.25; resolved ⇔ reproduced ∧ after < 0.25 ∧ after ≤ 0.5·before.
// Not reproduced ⇒ class kept, classRationale starts "Provisional: misreading did not reproduce…".
// Unresolved after one retry ⇒ design_gap marked "Provisional:".
// Fidelity also checks, for every v0 sentence an edit replaces or deletes, that its rules are still stated
// (FactCheck with factId = the sentence id), so it works without a reference.
classifyByRepair(ctx, version: PolicyVersion, draft: FindingDraft,
  deps: { scenarios: Scenario[]; codebook: Cluster[]; readings: Reading[]; codings: Coding[] }): Promise<Finding>

// metrics.ts: pure, seeded
conflictRate(readings: Reading[], grades: Grade[], threshold: number): number
bootstrapCI(values: number[], iterations: number, seed: number): Interval
// one cohort per call (one version + one replicate tag); missing readings are excluded, never counted as passes
iterationMetrics(args: { version: number; readings: Reading[]; grades: Grade[]; codings: Coding[]; findings: Finding[];
  scenarioIdsByFinding: Record<string, string[]>; noiseBand: number | null; noiseBandScenarios: number | null;
  threshold: number; seed: number }): Omit<Iteration, "decision" | "reason">
// paired over scenarios in both runs: d_s ∈ {−1,0,1}; band = max(|mean d|, 1.96·sd(d)/√n)
noiseBand(a: { readings: Reading[]; grades: Grade[] }, b: { readings: Reading[]; grades: Grade[] }, threshold: number): { band: number; pairedScenarios: number }

// stop.ts: pure
stopDecision(args: { history: Iteration[]; current: Omit<Iteration, "decision" | "reason">; iterationIndex: number;
  maxIterations: number; fidelityFailures: number; conflictMeasured: boolean }): { decision: "continue" | "stop"; reason: string }
```

## src/eval (P3)

```ts
runBaseline(ctx, version: PolicyVersion, opts: { id: string; model: string; effort: Effort }): Promise<BaselineRun>
// blind: each system's items are shown anonymised ("System A") and shuffled; one call per (edge case, system).
// Loads the holdout itself (only src/eval may); returns null when the policy has no holdout.
// Adds aggregate systems "baseline-mean" and "baseline-union" over the replicate systems /^baseline-\d+$/;
// "baseline-astra" is scored separately. The scorer returns ALL matching items per edge case; an item is
// "unmatched by holdout" only if it matched no edge case. Item text includes the quoted policy sentence(s).
scoreAgainstHoldout(ctx, args: { version: PolicyVersion; seed: number;
  systems: Array<{ id: string; label: string; items: Array<{ id: string; text: string }> }> }): Promise<Score | null>
humanQuestions(ctx, version: PolicyVersion, findings: Finding[]): Promise<HumanQuestion[]>   // 3 neutral VN questions
// Answers are coded against the frozen codebook with the same predicates as persona readings, then mapped to the
// finding whose evidence clusters hold the strongest belief ≥ 0.5 (else null).
mapHumanAnswers(ctx, args: { answers: HumanAnswer[]; questions: HumanQuestion[]; findings: Finding[]; codebook: Cluster[] }): Promise<HumanMapping[]>
```

## src/sandbox (cut first)

```ts
// rule.ts: pure state machine with explicit assumptions
interface RuleAssumptions { threshold: number; windowDays: number; countsCourierMarked: boolean; countsDamagedRefusal: boolean;
  recoveryPrepaidOrders: number; lockScope: "account" }
// tools.ts: persona ToolDefs (src/shared/actions PersonaToolInputs) bound to a sandbox world
// episode.ts
// COD only (throws for other policies before any model call); null when the readings evidence no strategy
runProbe(ctx, args: { readings: Reading[]; assumptions: RuleAssumptions; days: number }): Promise<ProbeResult | null>
```

## src/pipeline (P1)

```ts
runWindTunnel(args: { runId: string; config: RunConfig }): Promise<void>         // all modes
// Rewrite acceptance compares conflict rates on IDENTICAL scenario ids (< 5 paired ⇒ inconclusive stop).
// Retest: uses the suite's v0 text from its log; refuses if reference/folk hashes (RunConfig.inputs) or Decisions /
// embeddings provenance differ from the suite run. verdict = pass | fail | inconclusive (< 5 paired noise scenarios,
// or a required finding unmeasured, n = 0 on either side).
retestEdit(args: { runId: string; suiteRunId: string; surfaces: Surface[]; smoke: boolean }): Promise<SuiteComparison>
```
