/**
 * Not a sender. A call here used to return ok without placing anything.
 * Live perpetual orders go through live-transport.ts and POST /api/live/perp-fire.
 */
export const PERPS_ORDERS_LOCKED = false;
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