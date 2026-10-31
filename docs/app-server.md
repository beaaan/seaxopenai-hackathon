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

## If App Server misbehaves

Set `LLM_AGENT_BACKEND=responses`. Agent threads then run as a Responses function-calling loop with the same `ToolDef`s and the same `ThreadItemRecord` events.
