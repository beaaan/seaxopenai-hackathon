/**
 * pwt — Policy Wind Tunnel CLI.  Usage: `npm run pwt -- <command> [args]`
 *
 *   runs                         list runs in runs/
 *   validate <runId>             validate every event of a run; print counts by type
 *   policy <policyId>            print version-0 sentence ids (use them in reference.json)
 *   fixture [runId]              (re)write the synthetic UI fixture run (default: fixture)
 *   smoke [--backend b] [--model m]
 *                                live check of the LLM gateway: one structured call, one
 *                                agent turn with a dynamic tool, embeddings (responses only).
 *                                b = responses | appserver | both (default both)
 */
import { parseArgs } from "node:util";
import { z } from "zod";
import { PERSONA_TOOL_DESCRIPTIONS, PersonaToolInputs } from "./shared/actions";
import type { BackendName } from "./core/env";
import { writeFixtureRun } from "./core/fixture";
import { Gateway } from "./core/llm/gateway";
import { listPolicyIds, loadFolk, loadPolicyPackage, loadReference, versionZero } from "./core/policy";
import { listRuns, readEvents } from "./core/store";

function usage(): never {
  console.error("usage: pwt <runs | validate <runId> | policy <policyId> | fixture [runId] | smoke [--backend b] [--model m]>");
  process.exit(2);
}

function cmdRuns(): void {
  const runs = listRuns();
  if (runs.length === 0) console.log("no runs");
  for (const r of runs) console.log(`${r.runId.padEnd(28)} ${String(r.policyId).padEnd(16)} ${String(r.events).padStart(6)} events  ${r.status.padEnd(9)} ${r.startedAt ?? ""}`);
}

function cmdValidate(runId: string): void {
  const events = readEvents(runId);
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  events.forEach((e, i) => {
    if (e.seq !== i) throw new Error(`seq gap: line ${i + 1} has seq ${e.seq}`);
  });
  console.log(`${runId}: ${events.length} valid events`);
  for (const [type, n] of [...counts].sort()) console.log(`  ${type.padEnd(22)} ${n}`);
}

function cmdPolicy(policyId: string): void {
  if (!listPolicyIds().includes(policyId)) throw new Error(`no such policy: ${policyId} (have: ${listPolicyIds().join(", ")})`);
  const pkg = loadPolicyPackage(policyId);
  const v0 = versionZero(pkg);
  console.log(`${pkg.title}\nretrieved ${pkg.retrievedAt}; reference: ${loadReference(policyId) ? "yes" : "MISSING"}; folk versions: ${loadFolk(policyId).versions.length}\n`);
  for (const s of v0.sentences) console.log(`${s.id.padEnd(12)} ${s.text}`);
}

async function smokeOne(backend: BackendName, model: string): Promise<void> {
  const gateway = new Gateway({ bulk: backend, agent: backend, cacheDir: "cache/smoke" });
  try {
    let t = Date.now();
    const reading = await gateway.structured({
      role: "smoke",
      instructions: "Bạn là bà Lan, 52 tuổi, ở Hà Giang, chỉ trả tiền mặt. Trả lời ngắn, đúng giọng của bà.",
      input:
        "Bạn đọc dòng này trên điện thoại: \"Shopee đang tạm thời tắt chức năng Thanh toán khi nhận hàng của bạn do hệ thống ghi nhận lịch sử mua hàng của bạn có số lượng đơn hàng COD giao không thành công vượt quá quy định hiện hành\". Bạn hiểu thế nào?",
      schema: z.strictObject({ paraphraseVi: z.string(), worryVi: z.string().nullable() }),
      schemaName: "smoke_reading",
      model,
      effort: "low",
      fresh: true,
    });
    console.log(`[${backend}] structured ${Date.now() - t} ms →`, reading);

    t = Date.now();
    const calls: unknown[] = [];
    const thread = await gateway.agentThread({
      role: "hero",
      label: "smoke persona",
      instructions: "Bạn là bà Lan, 52 tuổi, ở Hà Giang, chỉ trả tiền mặt. Chỉ hành động bằng các công cụ được cung cấp.",
      tools: [
        {
          name: "place_order",
          description: PERSONA_TOOL_DESCRIPTIONS.place_order,
          input: PersonaToolInputs.place_order,
          handler: async (args) => {
            calls.push(args);
            return { ok: false, cod_available: false, message: "Phương thức Thanh toán khi nhận hàng tạm thời không khả dụng." };
          },
        },
      ],
      model,
      effort: "low",
      persist: false,
    });
    const result = await thread.turn("Bạn muốn mua một nồi cơm điện khoảng 500.000đ. Hãy đặt hàng, rồi nói ngắn gọn bạn sẽ làm gì tiếp.");
    await thread.close();
    console.log(`[${backend}] agent turn ${Date.now() - t} ms, tool calls:`, calls, `\n  final: ${result.finalText}`);

    if (backend === "responses") {
      t = Date.now();
      const vectors = await gateway.embed(["khách không nhận hàng", "người mua từ chối nhận hàng"]);
      console.log(`[${backend}] embeddings ${Date.now() - t} ms → ${vectors.length} × ${vectors[0]?.length ?? 0}`);

      t = Date.now();
      const answers = await gateway.decide({
        role: "smoke",
        evidence:
          "Văn bản: \"Shopee đang tạm thời tắt chức năng Thanh toán khi nhận hàng của bạn do hệ thống ghi nhận lịch sử mua hàng của bạn có số lượng đơn hàng COD giao không thành công vượt quá quy định hiện hành\".",
        data: { reading: reading.paraphraseVi },
        questions: [
          { type: "predicate", name: "states_threshold", instructions: "Does the reading claim the text states a specific number of failed orders?" },
          {
            type: "choice",
            name: "grade",
            instructions: "How does the reading relate to the text?",
            choices: [
              { value: "consistent", description: "Says what the text says." },
              { value: "conflicts", description: "Contradicts the text." },
              { value: "outside", description: "Adds something the text does not say." },
            ],
          },
        ],
        fresh: true,
      });
      console.log(`[${backend}] decisions ${Date.now() - t} ms →`, JSON.stringify(answers));
    }
  } finally {
    await gateway.close();
  }
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { backend: { type: "string", default: "both" }, model: { type: "string", default: "gpt-6-luna" } },
  });
  const [command, arg] = positionals;
  switch (command) {
    case "runs":
      return cmdRuns();
    case "validate":
      return cmdValidate(arg ?? usage());
    case "policy":
      return cmdPolicy(arg ?? usage());
    case "fixture": {
      const runId = arg ?? "fixture";
      const { events } = writeFixtureRun({ runId });
      console.log(`wrote runs/${runId}/events.jsonl (${events} events)`);
      return;
    }
    case "smoke": {
      const backends: BackendName[] =
        values.backend === "both" ? ["responses", "appserver"] : values.backend === "responses" || values.backend === "appserver" ? [values.backend] : usage();
      for (const b of backends) await smokeOne(b, values.model);
      return;
    }
    default:
      usage();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
