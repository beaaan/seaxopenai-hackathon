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
| Findings outside the reference | Findings with no holdout match | Human-check survival (k of n people gave that reading) |
| Conflict rate | Share of readings with ≥ 1 interpretation graded `conflicts` (Decisions; threshold calibrated on hand labels) | Bootstrap 95% CI and the test–retest noise band |
| Finding reproduction | Per finding: mean codebook probability of its beliefs over its original scenarios, before vs after a rewrite | Before/after |
| Split score | Normalised mutual information between a dimension's levels and the codebook probabilities, with a permutation z-score | Per batch, in the allocation panel |
| Grader agreement | Cohen's κ between Decisions grades and P4's hand labels on about 20 interpretations from the seed batch | One number, shown once |
| Discovery curve | New clusters of size ≥ 2 per batch | Exploration stopping signal |

**Blind scoring.** The scorer receives the edge cases and two anonymised, shuffled lists of findings (System A / System B). It answers match or no match for each pair and cites the item id.

**Noise band.** Run v0 twice with `fresh: true` and code both runs against the same codebook. A rewrite only counts as an improvement if the conflict rate falls by more than |Δ| between those two runs.

**One instrument.** All before/after comparisons go through the same fixed codebook, applied by the Decisions API. Clusters are only regenerated to discover new misreadings, never to measure change.

**Grader calibration.** At G1, P4 hand-labels about 20 interpretations without seeing the grader's output. We pick the probability threshold for `conflicts` on those labels and report the agreement.

## Human check

- The `/check` mobile page shows the original text and three neutral questions in Vietnamese. The questions are generated from the top findings and reviewed by P4 to remove leading wording.
- Free-text answers are stored as `human.answer` events and coded against the same codebook with the Decisions API, exactly as the persona readings are.
- Target: 6–8 people at the venue.
- The result is qualitative only: whether a finding survives contact with real people.

## Limitations (say these before judges ask)

- The reference is ours, so recall against it measures rediscovery. Findings outside the reference that survive the human check are the real test, and that check is small.
- Personas are not a population sample. The claim is coverage of distinct readings, not how common each reading is.
- Venue participants are tech-savvy. They are not remote cash-only buyers.
- Shopee does not publish its COD threshold or window, so any sandbox numbers are labelled assumptions.
- Folk versions: "3 failed deliveries in 90 days" appears only on third-party sites. Our pitch must never attribute it to Shopee.
