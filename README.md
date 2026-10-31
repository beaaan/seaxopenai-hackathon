# Policy Wind Tunnel

Marketplace rules reach people as text, and many policy failures happen in the gap between what a rule says, what people think it says, and what they do about it. Policy Wind Tunnel reads a policy the way its users will:
- Persona readers in Vietnamese, each with a realistic channel, attention span and prior belief, record their readings.
- The system finds the misreadings and the behaviour the wording invites.
- It rewrites what wording can fix and says plainly what it can't (design gaps, missing information).
- It re-tests every future edit against the same suite.

Built at the Sea × OpenAI Codex Hackathon Vietnam, 31 Oct 2026.

- **Worked example:** Shopee VN's COD help article 79294, verbatim (`policies/cod`).
- **Second policy:** Grab VN scheduled-ride cancellation terms (`policies/grab-scheduled`).

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
