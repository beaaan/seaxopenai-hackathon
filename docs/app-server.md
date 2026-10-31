# Codex App Server — verified notes (codex-cli 0.166.0, 31 Oct 2026)

Implementation: `src/core/llm/appserver.ts`. Generated wire types: `vendor/codex-app-server/` (`npm run codex:types`).

## Wire shapes we use

```jsonc
→ {"method":"initialize","id":0,"params":{"clientInfo":{"name":"policy_wind_tunnel","title":"Policy Wind Tunnel","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}
→ {"method":"initialized","params":{}}
→ {"method":"thread/start","id":1,"params":{"model":"gpt-6.1-sol","ephemeral":true,"approvalPolicy":"never","sandbox":"read-only",
     "baseInstructions":"<persona / role prompt>",
     "dynamicTools":[{"type":"function","name":"place_order","description":"…","inputSchema":{…}}]}}
→ {"method":"turn/start","id":2,"params":{"threadId":"…","input":[{"type":"text","text":"…","text_elements":[]}],"effort":"low","outputSchema":{…}}}
← {"method":"item/tool/call","id":<srvId>,"params":{"threadId","turnId","callId","namespace":null,"tool":"place_order","arguments":{…}}}
→ {"id":<srvId>,"result":{"contentItems":[{"type":"inputText","text":"{…}"}],"success":true}}
← {"method":"item/completed","params":{"threadId","item":{"type":"dynamicToolCall"|"agentMessage"|"reasoning"|"userMessage",…}}}
← {"method":"turn/completed","params":{"threadId","turn":{"status":"completed"|"failed"|"interrupted","error":…}}}
← {"method":"thread/tokenUsage/updated","params":{"threadId":"…","turnId":"…","tokenUsage":{"total":{"inputTokens":1234,"cachedInputTokens":1024,"outputTokens":250,"reasoningOutputTokens":100,"totalTokens":1484,"cacheWriteInputTokens":0},"last":{…},"modelContextWindow":272000}}}
```

## Observed behaviour

- `baseInstructions` fully replaces the Codex coding persona, so persona prompts go there.
- `dynamicTools` requires `capabilities.experimentalApi: true`. It is absent from the generated `ThreadStartParams` type, so we extend that type locally.
- `outputSchema` on `turn/start` yields strict JSON in the final `agentMessage` text.
- Throughput on one process with ChatGPT login and effort `low`: 9 concurrent readings finished in 40.7 s wall. Each took about 28 s on `gpt-6-luna` and 36–41 s on `gpt-6.1-sol`.
- Through `pwt smoke` (gateway code path, `gpt-6-luna`): a structured call took 6.5 s. An agent turn with one dynamic tool call took 5.3 s.
- Models on the team login: `gpt-6.1-sol, gpt-6-astra, gpt-6-sol, gpt-6-luna, gpt-5.6-*, gpt-6.1-terra, gpt-5.5`.
- stderr may repeat `failed to refresh available models: request timed out` on slow networks. It is harmless, and cold start takes about 15 s. Keep one long-lived process.
- Windows: `codex` is a `.cmd` shim, so spawn it with a shell and a single command string.
- Token usage is exposed by `thread/tokenUsage/updated` (`ThreadTokenUsageUpdatedNotification` in the generated types). `total` is cumulative for the thread, while `last` covers the last model request. The optional usage logger records the delta of cumulative totals over each turn, including intermediate tool steps, rather than billing the thread's previous turns again. A turn that emits no usage notification is recorded with null token counts, not estimates.

## If App Server misbehaves

Set `LLM_AGENT_BACKEND=responses`. Agent threads then run as a Responses function-calling loop with the same `ToolDef`s and the same `ThreadItemRecord` events.

## Opt-in token measurement

Set `PWT_USAGE_LOG` to a JSONL file path before running the CLI. Responses, Decisions, embeddings, and App Server backends synchronously append reported API usage after real requests; cache hits do not log. Request `stage` is attribution metadata only and is excluded from prompts and cache keys. Embedding requests honor `{ fresh: true }`, threaded from the run's `--fresh`, to bypass their per-text cache for measurement.

Every row has `ts`, `backend`, `model`, `stage`, `inputTokens`, `cachedInputTokens`, `outputTokens`, and `reasoningTokens`. Missing API fields remain null. Responses and Decisions use their `usage` objects; embeddings report only `usage.prompt_tokens`. Responses reasoning tokens are already included in `output_tokens` (`output_tokens_details` is a breakdown), so they must not be charged again. SDK-internal retries that return no usage object are not separately observable.

Summarize a dedicated run's log with `npx tsx scripts/usage-summary.ts runs/usage-probe/usage.jsonl --run-id usage-probe --output docs/usage-probe.json`. The script reads that run's domain events to count unique scenarios and first-to-last wall time. It preserves unreported totals as null and lists missing fields explicitly; an unknown billable usage value makes the total cost null while retaining the known subtotal. Prices are standard short-context USD per million tokens, retrieved from <https://developers.openai.com/api/docs/pricing> on 2026-10-31: gpt-6.1-sol $2 / $0.10 / $10, gpt-6-luna $0.10 / $0.01 / $0.50, gpt-6-astra $10 / $1 / $50 (input / cached input / output); `text-embedding-3-small` input $0.02, with no cached-input or output rate listed.
