import type { ToolDef } from "../core/llm/types";
import { PERSONA_TOOL_DESCRIPTIONS, PersonaToolInputs, type PersonaToolName } from "../shared/actions";
import type { ProbeStep } from "../shared/schema";
import { advanceDays, claimDamaged, countFailures, createAccount, isLocked, placeOrder, refuseDelivery, switchPrepaid, type Transition, type World } from "./rule";

/** The episode moves this boundary forward for each weekly turn. */
export interface ProbeClock {
  endDay: number;
}

interface ToolResponse {
  success: boolean;
  day: number;
  account_id: string;
  order_id: string | null;
  cod_available: boolean;
  countable_failures: number;
  message: string;
}

/** Rule transitions stay pure; only these tool bindings mutate the shared world. */
export function createPersonaTools(world: World, steps: ProbeStep[], clock: ProbeClock): ToolDef[] {
  const initialAccount = world.accounts[0];
  if (!initialAccount) throw new Error("Thế giới mô phỏng cần ít nhất một tài khoản.");
  let activeAccount = initialAccount.id;

  function apply(transition: Transition): ToolResponse {
    Object.assign(world, transition.world);
    activeAccount = transition.accountId;
    return response(transition.accepted, transition.message, transition.orderId);
  }

  function response(success: boolean, message: string, orderId: string | null = null): ToolResponse {
    return {
      success,
      day: world.day,
      account_id: activeAccount,
      order_id: orderId,
      cod_available: !isLocked(world, activeAccount),
      countable_failures: countFailures(world, activeAccount),
      message,
    };
  }

  function requireOwnOrder(orderId: string): void {
    if (!world.orders.some((entry) => entry.id === orderId && entry.account === activeAccount)) {
      throw new Error("Đơn này không tồn tại trên tài khoản mô phỏng đang dùng.");
    }
  }

  function execute(name: PersonaToolName, raw: unknown): ToolResponse {
    switch (name) {
      case "place_order": {
        const args = PersonaToolInputs.place_order.parse(raw);
        return apply(placeOrder(world, { account: activeAccount, payment: args.payment_method }));
      }
      case "refuse_delivery": {
        const args = PersonaToolInputs.refuse_delivery.parse(raw);
        requireOwnOrder(args.order_id);
        return apply(refuseDelivery(world, args.order_id));
      }
      case "claim_damaged": {
        const args = PersonaToolInputs.claim_damaged.parse(raw);
        requireOwnOrder(args.order_id);
        return apply(claimDamaged(world, args.order_id));
      }
      case "create_account": {
        PersonaToolInputs.create_account.parse(raw);
        const owner = world.accounts.find((entry) => entry.id === activeAccount)?.owner;
        if (!owner) throw new Error("Không tìm thấy chủ tài khoản mô phỏng.");
        return apply(createAccount(world, owner));
      }
      case "switch_prepaid": {
        const args = PersonaToolInputs.switch_prepaid.parse(raw);
        return apply(switchPrepaid(world, activeAccount, args.method));
      }
      case "contact_support": {
        PersonaToolInputs.contact_support.parse(raw);
        return response(true, "CSKH mô phỏng chỉ nhắc lại trạng thái theo giả định; không xác minh quy định thật và không tự mở khóa COD.");
      }
      case "wait_days": {
        const args = PersonaToolInputs.wait_days.parse(raw);
        const elapsed = Math.min(args.n, Math.max(0, clock.endDay - world.day));
        Object.assign(world, advanceDays(world, elapsed));
        return response(true, elapsed < args.n ? `Đã chờ ${elapsed} ngày tới hết lượt tuần này; không thể vượt quá thời hạn lượt.` : `Đã chờ ${elapsed} ngày trong mô phỏng.`);
      }
    }
  }

  return (Object.keys(PersonaToolInputs) as PersonaToolName[]).map((name) => ({
    name,
    description: PERSONA_TOOL_DESCRIPTIONS[name],
    input: PersonaToolInputs[name],
    handler: async (raw: unknown): Promise<ToolResponse> => {
      const day = world.day;
      const argsJson = JSON.stringify(raw) ?? "null";
      let result: ToolResponse;
      try {
        result = world.day >= clock.endDay
          ? response(false, "Đã hết thời gian của lượt tuần này. Hãy kết thúc lượt và chờ tuần tiếp theo.")
          : execute(name, raw);
      } catch (error: unknown) {
        result = response(false, `Không thực hiện thao tác mô phỏng: ${error instanceof Error ? error.message : "đối số không hợp lệ"}`);
      }
      steps.push({ day, tool: name, argsJson, resultJson: JSON.stringify(result) });
      return result;
    },
  }));
}
