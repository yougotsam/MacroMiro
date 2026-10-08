/**
 * Execution gate (priority #2): YES and NO are scored separately against executable prices.
 *   edge = P_side − UNCERTAINTY − price − fee/contract
 * Maker: post-only bid one tick inside the spread (never crossing), fee 0 on quadratic series, edge ≥ 1¢.
 * Taker: pay the side's ask (top level only), quadratic fee, edge ≥ 4¢.
 * The settlement model alone (no feature shift) must also clear BASE_MIN_EDGE at that price, so
 * indicators can rank and size but never create a trade by themselves.
 */
import {
  BASE_MIN_EDGE,
  MAKER_MIN_EDGE,
  MAX_ORDER_COST_USD,
  PRICE_MAX,
  PRICE_MIN,
  TAKER_MIN_EDGE,
  UNCERTAINTY,
} from "./config";
import { type FeeInfo, orderFee } from "./fees";

export type Level = { price: number; size: number };
/** Kalshi books are bids-only: YES bids and NO bids. YES ask = 1 − best NO bid. */
export type Book = { yesBid: Level | null; noBid: Level | null; ts: number };

export type Side = "yes" | "no";
export type Mode = "maker" | "taker";
export type Candidate = {
  side: Side;
  mode: Mode;
  price: number;
  count: number;
  fee: number;
  feePer: number;
  edge: number; // with features
  edgeBase: number; // settlement model only
  pSide: number;
};
export type GateResult = { best: Candidate | null; all: Candidate[]; failed: string | null; quotes: Record<string, number | null> };

const r4 = (x: number) => Math.round(x * 10_000) / 10_000;

/** tapered_deci_cent: 0.001 ticks below 0.10 and above 0.90, else 0.01 */
export function tickAt(price: number) {
  return price < 0.1 || price >= 0.9 ? 0.001 : 0.01;
}

export function sizeFor(price: number, maker: boolean, fee: FeeInfo, budget = MAX_ORDER_COST_USD) {
  let count = Math.floor(budget / price);
  while (count > 0 && count * price + orderFee(count, price, maker, fee) > budget + 1e-9) count -= 1;
  return count;
}

export function scoreSides(pYes: number, pYesBase: number, book: Book, fee: FeeInfo, opts: { allowMaker: boolean; allowTaker: boolean } = { allowMaker: true, allowTaker: true }): GateResult {
  const all: Candidate[] = [];
  const quotes: Record<string, number | null> = {
    yes_bid: book.yesBid?.price ?? null,
    yes_ask: book.noBid ? r4(1 - book.noBid.price) : null,
    no_bid: book.noBid?.price ?? null,
    no_ask: book.yesBid ? r4(1 - book.yesBid.price) : null,
  };
  if (!book.yesBid && !book.noBid) return { best: null, all, failed: "no_quote", quotes };
  let failed = "no_edge";
  let bandHit = false;
  for (const side of ["yes", "no"] as const) {
    const p = side === "yes" ? pYes : 1 - pYes;
    const pBase = side === "yes" ? pYesBase : 1 - pYesBase;
    const bid = side === "yes" ? book.yesBid : book.noBid;
    const opp = side === "yes" ? book.noBid : book.yesBid;
    const ask = opp ? r4(1 - opp.price) : null;
    // taker
    if (opts.allowTaker && ask != null && opp) {
      if (ask < PRICE_MIN || ask > PRICE_MAX) bandHit = true;
      else {
        const count = Math.min(sizeFor(ask, false, fee), Math.floor(opp.size));
        if (count >= 1) {
          const f = orderFee(count, ask, false, fee);
          const feePer = f / count;
          const edge = p - UNCERTAINTY - ask - feePer;
          const edgeBase = pBase - UNCERTAINTY - ask - feePer;
          if (edge >= TAKER_MIN_EDGE && edgeBase >= BASE_MIN_EDGE) all.push({ side, mode: "taker", price: ask, count, fee: f, feePer, edge, edgeBase, pSide: p });
        }
      }
    }
    // maker: one tick above our side's best bid, strictly below the ask (post-only)
    if (opts.allowMaker) {
      const base = bid?.price ?? 0;
      let price = r4(base + tickAt(base || 0.01));
      if (ask != null && price >= ask) price = r4(bid?.price ?? 0); // join the bid if improving would cross
      if (price <= 0 || (ask != null && price >= ask)) continue;
      if (price < PRICE_MIN || price > PRICE_MAX) {
        bandHit = true;
        continue;
      }
      const count = sizeFor(price, true, fee);
      if (count < 1) continue;
      const f = orderFee(count, price, true, fee);
      const feePer = f / count;
      const edge = p - UNCERTAINTY - price - feePer;
      const edgeBase = pBase - UNCERTAINTY - price - feePer;
      if (edge >= MAKER_MIN_EDGE && edgeBase >= BASE_MIN_EDGE) all.push({ side, mode: "maker", price, count, fee: f, feePer, edge, edgeBase, pSide: p });
    }
  }
  if (!all.length) return { best: null, all, failed: bandHit ? "no_edge_or_band" : failed, quotes };
  // rank by expected dollars (edge × count), taker first on ties because it fills
  all.sort((a, b) => b.edge * b.count - a.edge * a.count || (a.mode === "taker" ? -1 : 1));
  return { best: all[0], all, failed: null, quotes };
}

/** Edge of an existing resting maker order at its own price (for cancel/reprice). */
export function restingEdge(pYes: number, side: Side, price: number) {
  const p = side === "yes" ? pYes : 1 - pYes;
  return p - UNCERTAINTY - price;
}
