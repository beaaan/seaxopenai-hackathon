# Evaluation protocol

What we claim, how we measure it, and what we cannot claim.

## Sources of truth

| File | Author | Visible to | Purpose |
|---|---|---|---|
| `policies/<id>/policy.json` | copied verbatim from the source | everything | the text under test |
| `policies/<id>/reference.json` | human (P4), written before any agent output is seen | grader, judge, fidelity checker | facts the text states, things it does not cover, correct readings |
| `policies/<id>/holdout.json` | human (P4), same time | **scorer only** (`src/eval`) | ambiguous edge cases used to measure recall |
| `policies/<id>/folk.json` | verbatim quotes from third-party pages | scenario writer | prior beliefs readers bring with them |

**Pre-registration.** Commit the reference and holdout before the first real run. `git log -- policies/<id>/holdout.json` shows the time.

**Leak guard.** `npm run guard` fails in two cases: code outside `src/eval` reads the holdout, or a prompt mentions it.

## Metrics

| Metric | Definition | Shown with |
|---|---|---|
| Recall on holdout edge cases | Share of edge cases matched by at least one finding. A match means the same sentence and the same ambiguity, decided by a blind scorer. | Wind Tunnel vs single-pass baseline (mean of 3 runs, union of 3, plus 1 run on `gpt-6-astra`) |
| Unmatched by holdout | Wind Tunnel findings that match no holdout edge case. These are not validated and not disproved. | Human-check survival (k of n people gave that reading) |
| Conflict rate | Share of readings with ≥ 1 interpretation graded `conflicts` (Decisions; threshold calibrated on hand labels) | Bootstrap 95% CI and the test–retest noise band |
| Finding reproduction | Per finding: mean codebook probability of its beliefs over its original scenarios, before vs after a rewrite | Before/after, n, and the finding's own test–retest noise band |
| Split score | Normalised mutual information between a dimension's levels and the codebook probabilities, with a permutation z-score | Per batch, in the allocation panel |
| Grader agreement | Cohen's κ between Decisions grades and P4's hand labels on a held-out half of ~20 hand-labelled interpretations; the other half sets the threshold | One number, shown once |
| Discovery curve | New clusters with ≥ 2 distinct readers per batch; a cluster's identity across re-clustering is decided by member overlap | Exploration stopping signal |
| Compute | Persona readings per system (cached readings included); a baseline = 1 call, the aggregates = the number of replicate runs | Shown next to recall, so the comparison is honest about cost |

**Blind scoring.** For each edge case and each system, the scorer gets the edge case and that system's items, renumbered 1..k and shuffled, under a neutral label. It never sees system names, provenance or item ids. It answers match or no match, citing an item number. Baselines run three times with distinct replicate ids so they are independent samples, not one cached answer, and they get the same policy and reference evidence as the Wind Tunnel judge.

**Noise band (paired).** Run v0 twice with `fresh: true` on the same scenarios and code both runs against the same codebook. Per scenario, d = conflict(A) − conflict(B). The band is max(|mean d|, 1.96·sd(d)/√n).
- A rewrite counts as an improvement only if the conflict rate falls by more than the band.
- With fewer than 5 paired scenarios, the comparison is reported as inconclusive.
- Cohorts (version × replicate) are never pooled.
- Each finding gets its own band from the same two runs: d = reproduction(A) − reproduction(B) on that finding's scenarios coded in both. A finding with fewer than 5 such pairs has no noise estimate and is never judged as improved or regressed.
- Conflict-noise pairs require complete grades; finding-noise pairs require complete belief codings independently. A refused grade does not discard an otherwise valid belief measurement. Rewrite acceptance, recorded conflict bands and stopping use the same validated measurements.

**Policy CI verdict** (`npm run pwt -- test <surfaces.json> --suite <runId>`). The edited text is read on the suite's frozen scenarios and coded on its frozen codebook, then compared on identical scenarios. In CI a finding is measured as **prevalence over every selected scenario**, not only over its original holders, so an edit that spreads a misreading to new readers is caught. Each band is floored at 5 pp, the smallest change we report, because a saturated band (every pair at P≈1) can be zero.
- **fail**: the edit changes the rule (the blind fidelity check against v0 finds a new commitment or a lost fact), or the conflict rate (when a reference exists) or any finding rose beyond its band;
- **inconclusive**: fewer than 5 test–retest pairs, missing/refused conflict grades when a reference exists, nonidentical reader cohorts, incomplete finding codings, a finding without its own noise estimate, or — without a reference, where conflicts cannot be measured — no finding fell beyond its band;
- **pass** otherwise. The reasons list every rule change, regression, improvement and within-noise change.

Every selected scenario must have exactly one reading on each side, and every finding must have all of its associated beliefs coded on each reading. Equal counts alone do not establish matching cohorts. A refused cluster coding is unobserved, not zero. Automatic rewrites use this same gate over all selected scenarios before retaining a candidate, including people who did not originally hold a finding. Failed or inconclusive candidates retain the previous policy. Without a reference, continuation uses the finding-level gate rather than an unmeasured zero conflict rate.

Smoke runs (`--smoke`, `smokeSize` scenarios) start with the evidence scenarios of the findings anchored to the edited sentences, then cover the other findings round-robin.

A retest refuses to run if the reference or folk inputs changed since the suite (hash check), or if Decisions or embeddings provenance differs.

**One instrument.** All before/after comparisons go through the same fixed codebook, applied by the Decisions API. Clusters are only regenerated to discover new misreadings, never to measure change.

**Grader calibration.** At G1, P4 hand-labels about 20 interpretations without seeing the grader's output. Half of them set the probability threshold for `conflicts`; agreement (κ) is reported on the other half.

**Provenance.** Each run logs which backends produced it. Decisions answers are either real or emulated (without an API key, model-reported probabilities from structured outputs). The UI shows a badge for this. Emulated runs are for development only, and calibration from real runs is never reused for emulated ones.

**Classification validity.** Passing the fidelity check proves a repair preserved the facts, not that it resolved the misreading. A passing repair is re-read on up to 3 of the finding's scenarios and coded against the finding's beliefs. If it is still unresolved after one retry, the finding is marked "Provisional" design gap.

## Human check

- The `/check` mobile page shows the original text and three neutral questions in Vietnamese. The questions are generated from the top findings and reviewed by P4 to remove leading wording.
- Free-text answers are stored as `human.answer` events and coded against the same codebook with the Decisions API, exactly as the persona readings are.
- Target: 6–8 people at the venue.
- The result is qualitative only: whether a finding survives contact with real people.
- New submissions carry a per-run participant UUID separately from the optional display name. The phone retains it across reloads and offers an explicit new-person action for shared devices. Corrections append new answers; only the latest answer per participant and question contributes to counts and coding, and an older mapping cannot suppress a correction. Legacy logs remain readable with a null participant ID; their name-based identity cannot be recovered retrospectively, and the report labels that limitation.

## Limitations (say these before judges ask)

- The reference is ours, so recall against it measures rediscovery. Findings outside the reference that survive the human check are the real test, and that check is small.
- Personas are not a population sample. The claim is coverage of distinct readings, not how common each reading is.
- Venue participants are tech-savvy. They are not remote cash-only buyers.
- Shopee does not publish its COD threshold or window, so any sandbox numbers are labelled assumptions.
- Folk versions: "3 failed deliveries in 90 days" appears only on third-party sites. Our pitch must never attribute it to Shopee.
