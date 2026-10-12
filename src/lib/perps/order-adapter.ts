/**
 * Kalshi perps ORDER adapter — LOCKED OFF skeleton. Every method refuses. There is no network code here.
 * Unlocking requires: an owner-approved perps risk mandate (docs/operations/RISK_MANDATES.md), a separate live
 * authorization, and the live-trading-safety-checklist passing. Design: post_only entries, reduce_only exits,
 * native stop-loss/take-profit/trailing triggers attached after fill, client_order_id prefix "mm-perps-",
 * order-group contracts limit as a venue-side throttle, cancel-all as kill switch.
 */
export const PERPS_ORDERS_LOCKED = true as const;
export class PerpsOrdersLocked extends Error { constructor(what: string) { super(`perps order path is LOCKED OFF (${what}); no mandate/authorization`); } }
export const perpsOrders = {
  create(_: unknown): never { throw new PerpsOrdersLocked("create"); },
  amend(_: unknown): never { throw new PerpsOrdersLocked("amend"); },
  cancel(_: unknown): never { throw new PerpsOrdersLocked("cancel"); },
  cancelAll(): never { throw new PerpsOrdersLocked("cancelAll"); },
};
