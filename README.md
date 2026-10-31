# Policy Wind Tunnel

**Test how people will read a policy before you publish it.**

A platform rule only works if people understand it the way it was meant. Policy Wind Tunnel gives the exact text of a policy to dozens of simulated Vietnamese readers. Each reader has a situation, payment habits and an attention level, and some have already heard a rumour about the rule. Each one says what they think the text means and what they would do. The tool then answers five questions:

1. **Which sentences get misread, and by how many readers?** Every wrong belief that two or more readers share is traced to the sentence behind it.
2. **Does the official text correct what people already believe?** Readers can be told a rumour before reading, as happens in real life.
3. **Does a rewrite fix it?** A rewrite must keep every rule unchanged, and the same readers read it again. A change counts only if it is larger than the variation between two reads of the same text.
4. **What can wording not fix?** When every fix would change the rule or need information the text lacks, the tool says so and the policy owner decides.
5. **Does a later edit break anything?** Any edit can be re-tested on the same readers. It fails if it changes what the policy promises or makes a misreading more common.

The web app has four views: a landing page with the result on Shopee's article, the report for each run, a full-screen replay of a run (`#/live/<runId>`) where the reader flow (heard → where they read → what they believe) fills in as readers report back, next to the agent's tool calls as the event log recorded them, and `#/new`, where you pick a ready-made policy or paste your own and watch the readers test it live.

## What it found

**Shopee VN, "Why can't I choose cash on delivery?"** (help article 79294, verbatim; 50 simulated shoppers, run `cod-main`)
- 22 readers were told "3 failed COD orders within 90 consecutive days locks COD", a rule that circulates on coupon sites but appears on no Shopee page we could find. 16 of them came away believing a three-failure cutoff is policy: 3 of the 5 who read the help article, 6 of the 7 who saw only the checkout message, and 7 of the 10 who saw no official text. None of the 13 readers who heard no rumour came up with it. The groups are small; the pattern is that the official text does not dislodge the rumour.
- 11 of the 15 readers told "the lock lasts about 60 days" kept expecting a 60-day lock.
- 11 readers found no retry time in the checkout message "temporarily unavailable".
- The article gives no number, time window or lock duration, so it cannot correct either rumour. Every finding needs a rule decision or information Shopee has not published.
- Edit tests on the same readers (`cod-main-rt1`, `cod-main-rt2`, 10 readers each): a sentence spelling out the scope moved the mean belief score for the three-failure cutoff from 0.85 to 0.82, within variation, and made another misreading more likely, so it fails. An edit telling cash-only buyers to pay at a convenience store fails because it promises something the original never did.
- Against nine edge cases from research written before any run, scored blind, each single AI review found 8 and the wind tunnel 5. Three wind-tunnel findings matched no listed edge case; they are not validated. What the wind tunnel adds is how many readers each problem affects and what they had heard.

**Grab VN, scheduled-ride cancellation terms** (40 simulated riders, run `grab-main-noref`)
- A rewrite of the rider clauses lowered the mean belief score for "Driver-support funding remains unresolved for riders" across the same 12 readers from 0.97 to 0.62, beyond the ±0.05 variation between reads. The rewrite kept every rule unchanged. (Belief score: each reader's highest coded probability of holding the misreading, averaged.)

**Limits.** The simulated readers cover combinations of traits; they are not a sample of the population, so the counts are not national rates. Whether real people read the text the same way is checked on the phone page in the app (Ask real people).

Built at the Sea × OpenAI Codex Hackathon Vietnam, 31 Oct 2026. Policies: `policies/cod` (Shopee) and `policies/grab-scheduled` (Grab).

## Quick start

```bash
npm ci                              # install the exact dependencies in package-lock.json
cp .env.example .env                 # set OPENAI_API_KEY; `codex login` for App Server
npm run pwt -- smoke                 # live check: Responses, Decisions, embeddings, App Server
npm run pwt -- fixture               # synthetic run for the UI
npm run pwt -- run cod               # full run on the COD policy (~15–20 min)
npm run pwt -- test edit.json --suite <runId> --smoke   # policy CI on an edited text
npm run server                       # http://localhost:8787
npm run web                          # http://localhost:5173 (landing); #/live/cod-main replays the canonical run
npm run web -- --host                # same, reachable from phones on the venue Wi-Fi (human check: /#/check/<runId>)
npm run check                        # typecheck + tests + holdout guard + web build
```

Add `--demographics` to `pwt run` to design age groups (18–25, 30–45, 55–70) and low/high digital literacy explicitly; it is off by default, and written persona ages/literacy are corrected to their assigned levels.

For a talk, open `http://localhost:5173/presenter/` (speaker notes, talk clock and a chapter remote) and click **Open audience window**; the landing and the console follow each other over a same-origin `BroadcastChannel`. `/presenter/#/judges` is the Q&A screen, also linked from the landing.

## How it uses OpenAI

| Need | API |
|---|---|
| Persona readings, findings, rewrites, fidelity checks, baseline (generated text) | Responses API, Structured Outputs (`gpt-6.1-sol`) |
| Grading, codebook coding, quote anchoring, human-answer mapping (labels and probabilities) | Decisions API (`gpt-6-luna`) |
| Clustering readings | Embeddings (`text-embedding-3-small`) |
| Reviewer agent and tool-using hero personas, inspectable on stage | Codex App Server threads with client-side dynamic tools |

**Measured cost.** With `PWT_USAGE_LOG=<file>` set, every real API call logs its tokens and pipeline stage (`src/core/llm/usage.ts`; `scripts/usage-summary.ts` prices them). A fresh 20-reader run (`runs/usage-probe-metered`) made 372 calls and cost $1.54 at OpenAI list prices in 10 minutes ([docs/usage-probe.json](docs/usage-probe.json)). Estimated from those counts, `cod-main` (50 readers, three Sol reviews and one Astra review) cost about $2.56 in model calls. Retesting one edit costs about $0.11: ten fresh readings, graded and coded against the frozen groups, plus one fact check. One single AI review costs about $0.03.

## Docs

- [AGENTS.md](AGENTS.md): conventions, contracts, ownership, commands (read first)
- [docs/architecture.md](docs/architecture.md): pipeline and algorithms
- [docs/evaluation.md](docs/evaluation.md): reference/holdout protocol, metrics, limitations
- [docs/app-server.md](docs/app-server.md): verified Codex App Server wire notes
- [docs/research/policy-sources.md](docs/research/policy-sources.md): verbatim policy sources, folk versions, statistics check
- [docs/codex-log.md](docs/codex-log.md): how Codex was used to build this
