// Minimal stand-in for `codex app-server` (stdio JSONL), covering the subset pwt uses.
// - turn input containing "use tool" makes the server call the thread's first dynamic tool
// - turn input containing "fail" completes the turn with status "failed"
// - with outputSchema, the final agent message is {"echo": <input text>}
import { createInterface } from "node:readline";

const threads = new Map();
let threadSeq = 0;
let turnSeq = 0;
let serverReqSeq = 1000;
const awaitingClient = new Map();

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function runTurn(threadId, turnId, text, outputSchema) {
  const thread = threads.get(threadId);
  await delay(5 + (text.length % 7) * 3); // interleave concurrent turns deterministically
  send({ method: "item/completed", params: { threadId, turnId, item: { type: "userMessage", id: `u${turnId}`, content: [{ type: "text", text }] } } });
  let toolText = null;
  if (text.includes("use tool") && thread.tools.length > 0) {
    const tool = thread.tools[0];
    const id = serverReqSeq++;
    const reply = new Promise((resolve) => awaitingClient.set(id, resolve));
    send({ id, method: "item/tool/call", params: { threadId, turnId, callId: `c${id}`, namespace: null, tool: tool.name, arguments: { order_id: "o1" } } });
    const response = await reply;
    toolText = response.result.contentItems[0].text;
    send({
      method: "item/completed",
      params: { threadId, turnId, item: { type: "dynamicToolCall", id: `d${id}`, namespace: null, tool: tool.name, arguments: { order_id: "o1" }, status: "completed", contentItems: response.result.contentItems, success: response.result.success, durationMs: 1 } },
    });
  }
  if (text.includes("fail")) {
    send({ method: "error", params: { threadId, turnId, error: { message: "simulated failure" } } });
    send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "failed", items: [], error: { message: "simulated failure" } } } });
    return;
  }
  const finalText = outputSchema ? JSON.stringify({ echo: text }) : `done:${toolText ?? ""}`;
  if (text.includes("usage")) {
    for (let i = 0; i < 2; i++) {
      thread.usageCalls = (thread.usageCalls ?? 0) + 1;
      const last = { inputTokens: 100, cachedInputTokens: 40, cacheWriteInputTokens: 0, outputTokens: 20, reasoningOutputTokens: 5, totalTokens: 120 };
      const total = Object.fromEntries(Object.entries(last).map(([key, value]) => [key, value * thread.usageCalls]));
      send({ method: "thread/tokenUsage/updated", params: { threadId, turnId, tokenUsage: { total, last, modelContextWindow: 272000 } } });
    }
  }
  send({ method: "item/completed", params: { threadId, turnId, item: { type: "agentMessage", id: `m${turnId}`, text: finalText } } });
  send({ method: "turn/completed", params: { threadId, turn: { id: turnId, status: "completed", items: [], error: null } } });
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === undefined && msg.id !== undefined) {
    awaitingClient.get(msg.id)?.(msg);
    awaitingClient.delete(msg.id);
    return;
  }
  switch (msg.method) {
    case "initialize":
      if (!msg.params?.capabilities?.experimentalApi) return send({ id: msg.id, error: { code: -32600, message: "experimentalApi required" } });
      return send({ id: msg.id, result: { userAgent: "fake" } });
    case "initialized":
      return;
    case "thread/start": {
      const id = `thr_${++threadSeq}`;
      threads.set(id, { tools: msg.params.dynamicTools ?? [], baseInstructions: msg.params.baseInstructions });
      return send({ id: msg.id, result: { thread: { id } } });
    }
    case "turn/start": {
      const turnId = `turn_${++turnSeq}`;
      send({ id: msg.id, result: { turn: { id: turnId, status: "inProgress", items: [], error: null } } });
      void runTurn(msg.params.threadId, turnId, msg.params.input[0].text, msg.params.outputSchema);
      return;
    }
    case "thread/unsubscribe":
    case "turn/interrupt":
      return send({ id: msg.id, result: {} });
    default:
      return send({ id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } });
  }
});
