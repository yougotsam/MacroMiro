/**
 * Kalshi perps order adapter. The lock flag is off. Live posts go through live-transport.ts
 * and still have to clear the desk dollar caps. This file does not open a socket.
 */
export const PERPS_ORDERS_LOCKED = false;
export class PerpsOrdersLocked extends Error { constructor(what: string) { super(`perps order path is LOCKED OFF (${what}); no mandate/authorization`); } }
export const perpsOrders = {
  create(_: unknown) { return { ok: true as const, locked: false }; },
  amend(_: unknown) { return { ok: true as const, locked: false }; },
  cancel(_: unknown) { return { ok: true as const, locked: false }; },
  cancelAll() { return { ok: true as const, locked: false }; },
};
