/**
 * Read-only YES+NO pair-cost scanner for Kalshi binaries. Buying YES at the ask and NO at the ask locks $1 at
 * settlement. It is an arbitrage only if yesAsk + noAsk + both taker fees < $1.
 * On ONE binary book, yesAsk = 1 − bestNoBid and noAsk = 1 − bestYesBid, so the pair costs 2 − yesBid − noBid. That is
 * < 1 only if yesBid + noBid > 1, which is a crossed book the exchange cannot hold. So single-market pairs cannot
 * clear by construction. The scanner still checks every 15m market each run, and reports the gap so a data error
 * or crossed snapshot would show up. No orders.
 */
export type PairQuote = { ticker: string; yesBid: number | null; noBid: number | null };
export function pairCost(q: PairQuote, feeFn: (price: number) => number) {
  if (q.yesBid == null || q.noBid == null) return { ticker: q.ticker, status: "NO_BOOK" as const, cost: null, edge: null };
  const yesAsk = 1 - q.noBid, noAsk = 1 - q.yesBid;
  const cost = yesAsk + noAsk + feeFn(yesAsk) + feeFn(noAsk);
  return { ticker: q.ticker, status: cost < 1 ? ("ARB_CANDIDATE" as const) : ("NO_ARB" as const), cost: +cost.toFixed(4), edge: +(1 - cost).toFixed(4), yesAsk: +yesAsk.toFixed(4), noAsk: +noAsk.toFixed(4) };
}
/** Kalshi general taker fee per contract: ceil to the cent of 0.07 × P × (1 − P) (series multiplier may differ). */
export const takerFee = (p: number, mult = 0.07) => Math.ceil(mult * p * (1 - p) * 100 - 1e-9) / 100;
