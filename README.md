# Policy Wind Tunnel

**Test how people will read a policy before you publish it.**

A platform rule only works if people understand it the way it was meant. Policy Wind Tunnel gives the exact text of a policy to dozens of simulated Vietnamese readers. Each reader has their own situation, habits and attention span, and some have already heard a rumour about the rule from a friend or a website. Each one says what they think the text means and what they would do. The tool then answers five questions:

1. **Which sentences get misread, and by how many readers?** Every wrong belief that two or more readers share is traced to the sentence behind it.
2. **Does the official text correct what people already believe?** Rules travel as rumours, so readers can be told one first, the way it happens in real life.
3. **Does a rewrite actually fix it?** It rewrites what wording can fix, checks that the rewrite keeps every rule unchanged, and has the same readers read it again. A change only counts if it is bigger than the variation you get when the same readers read the same text twice.
4. **What can wording not fix?** When every fix would have to change the rule or add information the text doesn't have, it says so. That is a decision for the policy owner, not the copywriter.
5. **Does a later edit break anything?** Any edit can be re-tested on the same readers. It fails if it changes what the policy promises or makes a misreading worse.

## What it found

**Shopee VN, "Why can't I choose cash on delivery?"** (help article 79294, verbatim; 50 simulated shoppers, run `cod-main-noref`)
- 24 readers had been told "3 failed deliveries in 90 days locks COD", a rule that circulates on coupon sites but appears on no Shopee page we could find. After reading the official article, 15 of them still believed it. None of the 13 readers who had heard no rumour came up with it.
- Of 13 readers told "the lock lasts about 60 days", 8 still believed it after reading.
- The article gives no number, no time window and no lock duration, so it cannot correct either rumour. Every finding on this text needs a rule decision or information Shopee hasn't published; none can be fixed by rewording.

**Grab VN, scheduled-ride cancellation terms** (40 simulated riders, run `grab-main-noref`)
- A rewrite of the rider clauses cut "Driver-support funding remains unresolved for riders" from 97% to 62% of the same readers, beyond the ±5-point variation of re-reading. The rewrite passed the check that no rule changed.

**Limits.** The simulated readers are chosen to cover combinations of traits, not to match the population, so the counts show which misreadings are common among plausible readers, not national rates. Whether real people read the text the same way is checked on the phone page in the app (Human check).

Built at the Sea × OpenAI Codex Hackathon Vietnam, 31 Oct 2026. Policies: `policies/cod` (Shopee) and `policies/grab-scheduled` (Grab).

## Quick start

```bash
npm install
cp .env.example .env                 # set OPENAI_API_KEY; `codex login` for App Server
npm run pwt -- smoke                 # live check: Responses, Decisions, embeddings, App Server
npm run pwt -- fixture               # synthetic run for the UI
npm run pwt -- run cod               # full run on the COD policy (~15–20 min)
npm run pwt -- test edit.json --suite <runId> --smoke   # policy CI on an edited text
npm run server                       # http://localhost:8787
npm run web                          # http://localhost:5173 → pick run "fixture"
npm run web -- --host                # same, reachable from phones on the venue Wi-Fi (human check: /#/check/<runId>)
npm run check                        # typecheck + tests + holdout guard
```

## How it uses OpenAI

| Need | API |
|---|---|
| Persona readings, findings, rewrites, fidelity checks, baseline (generated text) | Responses API, Structured Outputs (`gpt-6.1-sol`) |
| Grading, codebook coding, quote anchoring, human-answer mapping (labels and probabilities) | Decisions API (`gpt-6-luna`) |
| Clustering readings | Embeddings (`text-embedding-3-small`) |
| Reviewer agent and tool-using hero personas, inspectable on stage | Codex App Server threads with client-side dynamic tools |

## Docs

- [AGENTS.md](AGENTS.md): conventions, contracts, ownership, commands (read first)
- [docs/architecture.md](docs/architecture.md): pipeline and algorithms
- [docs/evaluation.md](docs/evaluation.md): reference/holdout protocol, metrics, limitations
- [docs/app-server.md](docs/app-server.md): verified Codex App Server wire notes
- [docs/research/policy-sources.md](docs/research/policy-sources.md): verbatim policy sources, folk versions, statistics check
- [docs/codex-log.md](docs/codex-log.md): how Codex was used to build this
