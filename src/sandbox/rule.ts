import type { ProbeAssumption } from "../shared/schema";

export interface RuleAssumptions {
  threshold: number;
  windowDays: number;
  countsCourierMarked: boolean;
  countsDamagedRefusal: boolean;
  recoveryPrepaidOrders: number;
  lockScope: "account";
}

/** A circulating folk version for simulation, not Shopee's published rule. */
export const DEFAULT_ASSUMPTIONS: Readonly<RuleAssumptions> = Object.freeze({
  threshold: 3,
  windowDays: 90,
  countsCourierMarked: true,
  countsDamagedRefusal: true,
  recoveryPrepaidOrders: 1,
  lockScope: "account",
});

export function describeAssumptions(a: RuleAssumptions): ProbeAssumption[] {
  return [
    { id: "A1", text: `Assumption, not Shopee's published rule: ${a.threshold} countable failed COD deliveries trigger a COD lock; the numeric threshold is a circulating folk version.` },
    { id: "A2", text: `Assumption, not Shopee's published rule: failures count in the trailing ${a.windowDays} days, including today and excluding failures exactly ${a.windowDays} days old; the numeric window is a circulating folk version.` },
    { id: "A3", text: `Assumption, not Shopee's published rule: courier-marked failed COD deliveries ${a.countsCourierMarked ? "count" : "do not count"}, regardless of whether the buyer actually refused.` },
    { id: "A4", text: `Assumption, not Shopee's published rule: refusals of damaged COD parcels ${a.countsDamagedRefusal ? "count" : "do not count"}. The default counts them because the official text refers to failed COD deliveries without specifying a damage exemption.` },
    { id: "A5", text: `Assumption, not Shopee's published rule: ${a.recoveryPrepaidOrders} successfully delivered prepaid order(s) after a lock begins lift it. A subsequent countable COD failure can begin a new lock if the window still meets the threshold; recovery is a circulating folk version.` },
    { id: "A6", text: "Assumption, not Shopee's published rule: locks apply to an account, not its owner; a separate simulated account starts with no history. Account creation is allowed without identity checks in this toy world. Prepaid purchases complete successfully immediately; this is not a claim about real delivery times or account eligibility." },
  ];
}

export type Payment = "cod" | "shopeepay" | "bank_transfer" | "card" | "spaylater";
export type PrepaidPayment = Exclude<Payment, "cod">;
export type FailureCause = "buyer_refused" | "courier_marked" | "damaged_refused";

export interface Account {
  id: string;
  owner: string;
}

export interface Order {
  id: string;
  account: string;
  payment: Payment;
  status: "pending" | "delivered" | "failed";
  failureCause: FailureCause | null;
  /** Day of placement for pending orders, otherwise day of the delivery outcome. */
  day: number;
  completedSequence: number | null;
  lockedAfterFailure: boolean | null;
}

export interface AccountLock {
  account: string;
  beganDay: number;
  beganSequence: number;
  recoveredDay: number | null;
}

export interface World {
  day: number;
  assumptions: RuleAssumptions;
  accounts: Account[];
  orders: Order[];
  /** Lock episodes, in creation order; the latest episode is the per-account lock. */
  locks: AccountLock[];
  sequence: number;
}

export interface Transition {
  world: World;
  accepted: boolean;
  accountId: string;
  orderId: string | null;
  message: string;
}

function requireInteger(value: number, name: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} phải là số nguyên từ ${minimum} trở lên.`);
  }
}

function requireAccount(world: World, account: string): void {
  if (!world.accounts.some((entry) => entry.id === account)) {
    throw new Error(`Không có tài khoản mô phỏng ${account}.`);
  }
}

export function createWorld(assumptions: RuleAssumptions = DEFAULT_ASSUMPTIONS, owner = "Người tham gia mô phỏng"): World {
  requireInteger(assumptions.threshold, "threshold", 1);
  requireInteger(assumptions.windowDays, "windowDays", 1);
  requireInteger(assumptions.recoveryPrepaidOrders, "recoveryPrepaidOrders", 1);
  if (assumptions.lockScope !== "account" || typeof assumptions.countsCourierMarked !== "boolean" || typeof assumptions.countsDamagedRefusal !== "boolean") {
    throw new Error("Giả định phạm vi hoặc cách tính giao hàng thất bại không hợp lệ.");
  }
  return {
    day: 0,
    assumptions: { ...assumptions },
    accounts: [{ id: "account-1", owner }],
    orders: [],
    locks: [],
    sequence: 0,
  };
}

function isCountable(order: Order, a: RuleAssumptions): boolean {
  return order.payment === "cod" && order.status === "failed" && (
    order.failureCause === "buyer_refused" ||
    (order.failureCause === "courier_marked" && a.countsCourierMarked) ||
    (order.failureCause === "damaged_refused" && a.countsDamagedRefusal)
  );
}

export function countFailures(world: World, account: string, day = world.day): number {
  requireAccount(world, account);
  requireInteger(day, "Ngày", 0);
  return world.orders.reduce((count, order) => count + Number(
    order.account === account && order.day <= day && order.day > day - world.assumptions.windowDays && isCountable(order, world.assumptions),
  ), 0);
}

export function isLocked(world: World, account: string, day = world.day): boolean {
  if (countFailures(world, account, day) < world.assumptions.threshold) return false;
  const lock = world.locks.findLast((entry) => entry.account === account && entry.beganDay <= day);
  return !lock || lock.recoveredDay === null || lock.recoveredDay > day;
}

export function placeOrder(world: World, args: { account: string; payment: Payment }): Transition {
  requireAccount(world, args.account);
  if (args.payment === "cod" && isLocked(world, args.account)) {
    return { world, accepted: false, accountId: args.account, orderId: null, message: "COD đang bị khóa trên tài khoản này theo các giả định mô phỏng; chưa tạo đơn." };
  }
  const sequence = world.sequence + 1;
  const order: Order = {
    id: `order-${world.orders.length + 1}`,
    account: args.account,
    payment: args.payment,
    status: args.payment === "cod" ? "pending" : "delivered",
    failureCause: null,
    day: world.day,
    completedSequence: args.payment === "cod" ? null : sequence,
    lockedAfterFailure: null,
  };
  let locks = world.locks;
  if (args.payment !== "cod" && isLocked(world, args.account)) {
    const lockIndex = world.locks.findLastIndex((entry) => entry.account === args.account);
    const lock = world.locks[lockIndex];
    if (lock) {
      const successfulSinceLock = 1 + world.orders.reduce((count, previous) => count + Number(
        previous.account === args.account && previous.payment !== "cod" && previous.status === "delivered" &&
        previous.completedSequence !== null && previous.completedSequence > lock.beganSequence,
      ), 0);
      if (successfulSinceLock >= world.assumptions.recoveryPrepaidOrders) {
        locks = world.locks.map((entry, index) => index === lockIndex ? { ...entry, recoveredDay: world.day } : entry);
      }
    }
  }
  return {
    world: { ...world, sequence, orders: [...world.orders, order], locks },
    accepted: true,
    accountId: args.account,
    orderId: order.id,
    message: args.payment === "cod" ? "Đã tạo đơn COD trong mô phỏng, đang chờ giao." : "Đã ghi nhận một đơn trả trước giao thành công trong mô phỏng.",
  };
}

export function refuseDelivery(world: World, orderId: string, cause: FailureCause = "buyer_refused"): Transition {
  const order = world.orders.find((entry) => entry.id === orderId);
  if (!order) throw new Error(`Không có đơn mô phỏng ${orderId}.`);
  if (order.status !== "pending") {
    return { world, accepted: false, accountId: order.account, orderId, message: "Đơn này đã có kết quả giao hàng; không ghi nhận thất bại lần nữa." };
  }
  const sequence = world.sequence + 1;
  const failed: Order = { ...order, status: "failed", failureCause: cause, day: world.day, completedSequence: sequence };
  let next: World = { ...world, sequence, orders: world.orders.map((entry) => entry.id === orderId ? failed : entry) };
  if (isCountable(failed, world.assumptions) && !isLocked(world, order.account) && countFailures(next, order.account) >= world.assumptions.threshold) {
    next = { ...next, locks: [...world.locks, { account: order.account, beganDay: world.day, beganSequence: sequence, recoveredDay: null }] };
  }
  const locked = isLocked(next, order.account);
  next = { ...next, orders: next.orders.map((entry) => entry.id === orderId ? { ...entry, lockedAfterFailure: locked } : entry) };
  return {
    world: next,
    accepted: true,
    accountId: order.account,
    orderId,
    message: locked ? "Đã ghi nhận giao hàng thất bại; COD bị khóa theo các giả định mô phỏng." : "Đã ghi nhận giao hàng thất bại; tài khoản chưa bị khóa COD theo các giả định mô phỏng.",
  };
}

export function claimDamaged(world: World, orderId: string): Transition {
  return refuseDelivery(world, orderId, "damaged_refused");
}

export function createAccount(world: World, owner: string): Transition {
  const account: Account = { id: `account-${world.accounts.length + 1}`, owner };
  return {
    world: { ...world, accounts: [...world.accounts, account], sequence: world.sequence + 1 },
    accepted: true,
    accountId: account.id,
    orderId: null,
    message: "Đã tạo và chuyển sang tài khoản mô phỏng mới, không có lịch sử giao thất bại. Đây không phải xác nhận về khả năng tạo hoặc mượn tài khoản thật.",
  };
}

export function switchPrepaid(world: World, account: string, method: PrepaidPayment): Transition {
  return placeOrder(world, { account, payment: method });
}

export function advanceDays(world: World, days: number): World {
  requireInteger(days, "Số ngày chờ", 0);
  requireInteger(world.day + days, "Ngày", 0);
  return { ...world, day: world.day + days };
}
