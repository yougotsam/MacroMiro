/**
 * Not a sender. A call here used to return ok without placing anything.
 * The HTTP order endpoint and the dashboard share this compile-time policy.
 */
export const PERPS_ORDER_REFUSAL = Object.freeze({
  status: 503,
  why: "Perpetual orders are disabled pending server-owned margin risk, position reconciliation, and protective-exit validation.",
} as const);
export const PERPS_ORDERS_LOCKED = PERPS_ORDER_REFUSAL.status === 503;
export class PerpsOrdersLocked extends Error { constructor(what: string) { super(`perps order path is LOCKED OFF (${what}); no mandate/authorization`); } }
function refuse(): never {
  throw new Error("not a sender; the perpetual button uses live-transport");
}
export const perpsOrders = {
  create(_: unknown) { return refuse(); },
  amend(_: unknown) { return refuse(); },
  cancel(_: unknown) { return refuse(); },
  cancelAll() { return refuse(); },
};
