/**
 * Snapshot execution check against a real Kalshi perp book.
 * Queue position is UNKNOWN: the margin API has no queue endpoint.
 * A synthetic candle book is refused. This function does not invent size.
 */
import type { Book } from "./kalshi-perps-read";

export type BookKind = "venue" | "synthetic_candle";

export type ExecutionView = {
  executable: boolean;
  reason: string;
  mode: "maker" | "taker";
  limitPrice: number | null;
  displayedQtyAtLimit: number | null;
  takerFillQty: number;
  takerUnfilled: number;
  takerVwap: number | null;
  spread: number | null;
  queuePosition: "UNKNOWN";
  sameBarStopAndTarget: "AMBIGUOUS_ON_OHLC";
};

function walk(levels: [number, number][], qty: number): { fill: number; vwap: number | null; left: number; worst: number | null } {
  let need = qty, cost = 0, got = 0, worst: number | null = null;
  for (const [px, sz] of levels) {
    if (!(sz > 0) || need <= 0) continue;
    const take = Math.min(need, sz);
    cost += take * px;
    got += take;
    need -= take;
    worst = px;
  }
  return { fill: got, vwap: got > 0 ? cost / got : null, left: qty - got, worst };
}

/** Maker joins our side. Taker lifts the other side, only up to displayed size. */
export function evaluateExecution(book: Book, dir: "long" | "short", qty: number, mode: "maker" | "taker", bookKind: BookKind = "venue"): ExecutionView {
  const spread = book.bestBid != null && book.bestAsk != null ? +(book.bestAsk - book.bestBid).toFixed(6) : null;
  const blank = (reason: string): ExecutionView => ({
    executable: false, reason, mode, limitPrice: null, displayedQtyAtLimit: null, takerFillQty: 0, takerUnfilled: qty, takerVwap: null, spread, queuePosition: "UNKNOWN", sameBarStopAndTarget: "AMBIGUOUS_ON_OHLC",
  });
  if (bookKind !== "venue") return blank("synthetic book is not a fill");
  if (!(qty >= 1)) return blank("qty < 1");
  if (book.bestBid == null || book.bestAsk == null) return blank("book missing a side");
  if (mode === "maker") {
    const levels = dir === "long" ? book.bids : book.asks;
    const px = dir === "long" ? book.bestBid : book.bestAsk;
    const shown = levels.filter((x) => x[0] === px).reduce((s, x) => s + x[1], 0);
    return { executable: true, reason: "post-only join; fill is not promised", mode, limitPrice: px, displayedQtyAtLimit: shown, takerFillQty: 0, takerUnfilled: qty, takerVwap: null, spread, queuePosition: "UNKNOWN", sameBarStopAndTarget: "AMBIGUOUS_ON_OHLC" };
  }
  const levels = dir === "long" ? book.asks : book.bids;
  const w = walk(levels, qty);
  return {
    executable: w.fill > 0, reason: w.left > 0 ? `partial: ${w.fill} of ${qty} shown on the book` : `taker can lift ${w.fill} at displayed size`,
    mode, limitPrice: w.worst, displayedQtyAtLimit: null, takerFillQty: w.fill, takerUnfilled: w.left, takerVwap: w.vwap == null ? null : +w.vwap.toFixed(6),
    spread, queuePosition: "UNKNOWN", sameBarStopAndTarget: "AMBIGUOUS_ON_OHLC",
  };
}
