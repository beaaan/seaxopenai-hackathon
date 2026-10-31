# AGENTS.md — Policy Wind Tunnel

Instructions for Codex (and humans) working in this repo. Read this file fully before changing code.

## What we are building

An agent that reads a marketplace policy the way its users will. Persona readers read the real Vietnamese text and record their readings. The system then:
- clusters the misreadings into findings
- classifies each finding as **wording fix**, **design gap** or **unresolvable** by attempting a repair
- rewrites what wording can fix and reruns the same scenarios
- stops by a logged rule that compares improvement against a measured noise band

Every future edit is re-tested against the same suite ("policy CI").

- Worked example: Shopee VN COD help article 79294 (`policies/cod`).
- Second policy: Grab VN scheduled-ride cancellation (`policies/grab-scheduled`).
- Design: `docs/architecture.md`. Evaluation protocol: `docs/evaluation.md`. App Server wire notes: `docs/app-server.md`.

## Commands

```bash
npm install
cp .env.example .env              # then set OPENAI_API_KEY
npm run check                     # typecheck (node + web) + vitest + holdout guard; must pass before every merge
npm run server                    # API + SSE on :8787
npm run web                       # Vite UI on :5173 (proxies /api)
npm run pwt -- runs               # list runs
npm run pwt -- validate <runId>   # validate a run log
npm run pwt -- policy <policyId>  # print sentence ids (reference.json cites these)
npm run pwt -- fixture            # regenerate runs/fixture (synthetic UI data)
npm run pwt -- smoke --backend appserver|responses|both   # live LLM check
npm run codex:types               # regenerate vendor/codex-app-server from the installed codex
```

Windows: run commands from Git Bash or PowerShell; `codex` is spawned through a shell automatically.

## Contracts (frozen; changes go through the integration owner, P1)

| File | Contains |
|---|---|
| `src/shared/schema.ts` | Every domain type: PolicyPackage, PolicyVersion, Sentence, Reference, Holdout, FolkFile, Dimension, Scenario, Reading, Interpretation, Grade, Cluster, AllocationDecision, Finding, FidelityResult, Rewrite, Iteration, BaselineRun, Score, Human*, RunConfig, ThreadItemRecord |
| `src/shared/events.ts` | `EVENT_PAYLOADS`: event type → payload schema; `RunEvent`, `parseEvent` |
| `src/shared/actions.ts` | `ActionEnum` and persona tool input schemas, the same vocabulary for bulk readers and tool-using personas |
| `src/core/llm/types.ts` | `StructuredRequest`, `ToolDef`, `AgentThreadOptions`, `AgentThread` |
| `src/core/server.ts` | HTTP API the UI consumes (routes are listed in the file header) |

Rules for schemas:
- Use `z.strictObject`.
- Optional data is `.nullable()`, never `.optional()`.
- No `z.record`: use arrays of `{key, value}`.

These rules keep every shared schema usable as an OpenAI strict structured-output schema, and `tests/json-schema.test.ts` enforces them.

**Adding an event type:** add it to `EVENT_PAYLOADS` (that also extends the parser) and handle it in `web/src/state.ts`. Events are append-only; never rewrite a log. `clusters.updated` and `findings.updated` carry full replacements, not deltas.

## Ownership (one git worktree per owner; edit only your directories)

| Owner | Worktree / branch | Directories |
|---|---|---|
| P1 Runtime / integrator | `wt-runtime` | `src/shared/`, `src/core/`, `src/cli.ts`, `scripts/`, `vendor/`, `AGENTS.md`, merges to `main` |
| P2 Sampler | `wt-sampler` | `src/sampler/`: dimensions, covering array, scenario writer, reader, quote anchoring, allocation stats; `prompts/{dims,scenario,reader}.md` |
| P3 Reviewer loop + eval | `wt-reviewer` | `src/reviewer/`: grade, cluster, findings, classify, rewrite, fidelity, metrics, stop. `src/eval/`: baseline, score, human. `src/sandbox/`. `prompts/{grader,judge,rewriter,fidelity,reviewer,baseline,scorer}.md` |
| P4 Domain + UI + demo | `wt-ui` | `web/`, `policies/*/reference.json`, `policies/*/holdout.json`, `policies/*/folk.json`, `docs/` |

```bash
git worktree add ../pwt-sampler -b wt-sampler   # likewise wt-runtime, wt-reviewer, wt-ui
```
- Merge `main` into your branch often.
- Hand changes to P1 for `main` about every 45 minutes.
- Run Codex `/review` on the diff before handing it over.
- Need a contract change? Ask P1; don't edit `src/shared/` from another worktree.

## Conventions

- **TypeScript only**, strict, ESM, Node 26.
  - No `any`.
  - No `ReturnType<typeof f>` as a published type: name and export the type.
  - Validate external data (LLM output, JSON files, RPC) with zod at the boundary.
  - Prefer `Promise.withResolvers`.
- **All model calls go through `Gateway`** (`src/core/llm/gateway.ts`). Never import `openai` or spawn `codex` anywhere else.
  - `gateway.structured({role, instructions, input, schema, schemaName, model, effort})` handles bulk calls. It uses the Responses API by default (`LLM_BULK_BACKEND`), is cached, and returns zod-validated output.
  - `gateway.agentThread({role, label, instructions, tools, model, effort, persist, onItem})` handles the reviewer, hero personas and the probe. It uses Codex App Server by default (`LLM_AGENT_BACKEND`), with tools exposed as dynamic tools. Pipe `onItem` into `thread.item` events.
  - `gateway.embed(texts)` uses `text-embedding-3-small` at 512 dimensions, cached per text.
  - `gateway.decide({role, evidence, data, questions})` uses the **Decisions API** (`gpt-6-luna`) for every classification step: grading, codebook coding, quote-anchor fallback, human-answer mapping. Question types are `predicate` (probability), `choice` (distribution + confidence) and `score`. Up to 400 questions go in one request; larger sets are chunked automatically. Put long, stable context (policy + reference) in `evidence` so the prompt cache is reused, and per-item content in `data` (`input_json`). Use Decisions whenever the answer is a label, a probability or a score. Use `structured()` only when we need generated text.
  - Pass `fresh: true` only for the noise-band retest and live demo runs.
- **Prompts live in `prompts/<role>.md`**, one file per role and written in Vietnamese where a persona speaks. Load them at runtime; don't inline long prompts in code. Readers must stay in character:
  - be no more careful than the persona
  - it is fine to be wrong
  - quote only what the persona noticed
- **Models:**

  | Model · effort | Used for |
  |---|---|
  | `gpt-6.1-sol` · low | Readers |
  | `gpt-6.1-sol` · medium | Scenario writer, dimension extractor |
  | Decisions API, `gpt-6-luna` | Grader, codebook coding, anchor fallback, human mapping |
  | `gpt-6.1-sol` · high | Judge, rewriter, fidelity, reviewer |
  | `gpt-6.1-sol` · high ×3 and `gpt-6-astra` ×1 | Baseline |
  | `gpt-6.1-sol` · high, blind | Scorer |

  `gpt-6-luna` is the fallback when throughput is limited.
- **Pipeline output is events.** Each stage appends to a `RunWriter` (`src/core/store.ts`). The UI derives everything from the log, so don't add side channels.
- **Sentence ids** are `<surfaceId>.<n>` from `splitSentences`. Never renumber by hand; `npm run pwt -- policy <id>` prints them.

## Evaluation integrity (non-negotiable)

- The holdout file is read **only** by `src/eval/` (`loadHoldout`). Prompts never mention it. `npm run guard` enforces this.
- `reference.json` and `holdout.json` are written by P4 **before** the first real run and committed. The commit timestamp is the pre-registration.
- The grader and judge see `reference.json` facts. They never see holdout edge cases.
- Scoring is blind: systems are anonymised as A/B and shuffled.
- Every before/after number is shown with the test–retest noise band.

## Tests

- `npm run check` must pass before handing anything to P1.
- Write tests for behaviour that would hurt a consumer if it broke: boundaries, invariants (covering-array pair coverage, sandbox lock rules), and parsing of external data.
- Don't write tests that restate wiring or mock echoes. Use throwaway scripts for exploration.
- `tests/fixtures/fake-app-server.mjs` speaks the App Server subset we use; extend it rather than mocking `AppServerBackend`.

## Codex usage log

Append one line per Codex task to `docs/codex-log.md`: time · owner · ask · outcome (merged / edited / discarded). The pitch uses these numbers. Don't log tasks that weren't done with Codex.

## Don't

- Don't commit `.env`, `cache/` or `runs/dev-*`.
- Commit canonical runs under `runs/<name>/` deliberately.
- Don't hard-code COD specifics outside `policies/cod` and `prompts/`. The second policy must run through the same code.
- Don't present a Shopee number the official text doesn't contain. "3 failures in 90 days" is a folk version (see `docs/research/policy-sources.md`).
