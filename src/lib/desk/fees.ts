import { TAKER_FEE_RATE } from "./config";

/** ceil to n decimal places without float drift */
export function ceilDp(x: number, dp: number) {
  const m = 10 ** dp;
  return Math.ceil(x * m - 1e-9) / m;
}
export function floorDp(x: number, dp: number) {
  const m = 10 ** dp;
  return Math.floor(x * m + 1e-9) / m;
}

/**
 * Kalshi quadratic fee for one order (docs: Fee Rounding).
 * model fee = rate × multiplier × C × P × (1 − P); trade fee = ceil to $0.000001;
 * a direct member's balance moves on a $0.0001 grid, so the charged total is the
 * trade fee plus the rounding needed to land the cash change on that grid (upper bound).
 */
export function quadraticFee(count: number, price: number, multiplier = 1, rate = TAKER_FEE_RATE) {
  if (count <= 0 || price <= 0 || price >= 1) return 0;
  return quadraticFeeFills([{ count, price }], multiplier, rate);
}

/** One order that matched at several prices: model fees are summed, then rounded once for the order. */
export function quadraticFeeFills(fills: Array<{ count: number; price: number }>, multiplier = 1, rate = TAKER_FEE_RATE) {
  let model = 0;
  let cost = 0;
  for (const f of fills) {
    if (f.count <= 0 || f.price <= 0 || f.price >= 1) continue;
    model += rate * multiplier * f.count * f.price * (1 - f.price);
    cost += f.count * f.price;
  }
  if (cost <= 0) return 0;
  const trade = ceilDp(model, 6);
  const aligned = ceilDp(cost + trade, 4); // buyer pays: −(cost + fee) floored on the grid = cost+fee ceiled
  return Number((aligned - cost).toFixed(6));
}

export type FeeInfo = { feeType: string; multiplier: number };

/** Maker fills are free on fee_type "quadratic" (verified: every past maker fill on these series = $0). Anything else: assume maker pays the taker formula. */
export function orderFee(count: number, price: number, maker: boolean, info: FeeInfo = { feeType: "quadratic", multiplier: 1 }) {
  if (maker && info.feeType === "quadratic") return 0;
  return quadraticFee(count, price, info.multiplier);
}
