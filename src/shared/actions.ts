/**
 * The action vocabulary shared by bulk readers (as structured output) and
 * hero/probe personas (as dynamic tools). Identical contracts on both paths.
 */
import { z } from "zod";

export const ActionEnum = z.enum([
  "place_order_cod",
  "switch_prepaid",
  "refuse_delivery",
  "cancel_before_ship",
  "contact_support",
  "use_other_account",
  "create_new_account",
  "order_less",
  "stop_using_platform",
  "wait_and_retry",
  "other",
]);
export type ActionEnum = z.infer<typeof ActionEnum>;

/** Input schemas for persona tools (dynamic tools on App Server, function tools on Responses). */
export const PersonaToolInputs = {
  place_order: z.strictObject({
    item: z.string(),
    payment_method: z.enum(["cod", "shopeepay", "bank_transfer", "card", "spaylater"]),
    value_vnd: z.number().int().nonnegative(),
  }),
  refuse_delivery: z.strictObject({
    order_id: z.string(),
    reason: z.string(),
  }),
  claim_damaged: z.strictObject({
    order_id: z.string(),
  }),
  create_account: z.strictObject({
    reason: z.string(),
  }),
  switch_prepaid: z.strictObject({
    method: z.enum(["shopeepay", "bank_transfer", "card", "spaylater"]),
  }),
  contact_support: z.strictObject({
    message: z.string(),
  }),
  wait_days: z.strictObject({
    n: z.number().int().positive(),
  }),
} as const;
export type PersonaToolName = keyof typeof PersonaToolInputs;

export const PERSONA_TOOL_DESCRIPTIONS: Record<PersonaToolName, string> = {
  place_order: "Đặt một đơn hàng với phương thức thanh toán đã chọn.",
  refuse_delivery: "Từ chối nhận một đơn hàng khi shipper giao tới.",
  claim_damaged: "Báo hàng bị hư hỏng khi nhận.",
  create_account: "Tạo một tài khoản mới.",
  switch_prepaid: "Chuyển sang một phương thức thanh toán trả trước.",
  contact_support: "Liên hệ chăm sóc khách hàng (CSKH).",
  wait_days: "Chờ một số ngày rồi tiếp tục.",
};
