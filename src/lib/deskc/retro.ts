/**
 * Turns one logged desk decision plus a settlement into a scorecard row.
 * One ticker, one row: the caller picks which decision. This does not send an order.
 */
import { quadraticFee } from "../desk/fees";
import type { DecisionRow } from "./scorecard";

export type RawDecision = {
  ts?: string;
  ticker?: string;
  series?: string;
  tte_s?: number;
  p?: number;
  failed_gate?: string | null;
  quotes?: { yes_bid?: number; yes_ask?: number; no_bid?: number; no_ask?: number };
  fee_multiplier?: number;
  index_age_ms?: number;
  book_age_ms?: number;
  best?: { mode?: string } | null;
  confluence?: { long?: { setup?: string }; short?: { setup?: string } };
  close?: string;
  features?: { trend?: number | null; momentum?: number | null; group_votes?: { trend?: number | null; momentum?: number | null; structure?: number | null; candle?: number | null } };
};

export function toScoreRow(o: RawDecision, result: "yes" | "no" | undefined): DecisionRow | null {
  if (!o.ticker || !o.series || result !== "yes" && result !== "no") return null;
  const p = o.p;
  const q = o.quotes;
  const yb = q?.yes_bid;
  const ya = q?.yes_ask;
  if (typeof p !== "number" || !(p > 0 && p < 1)) return null;
  if (typeof yb !== "number" || typeof ya !== "number" || !(yb > 0 && ya >= yb && ya < 1)) return null;
  const yy: 0 | 1 = result === "yes" ? 1 : 0;
  const mid = (yb + ya) / 2;
  const buyYes = p >= 0.5;
  const price = buyYes ? ya : typeof q?.no_ask === "number" ? q.no_ask : 1 - yb;
  if (!(price > 0 && price < 1)) return null;
  const won = buyYes ? yy === 1 : yy === 0;
  const fee = quadraticFee(1, price, o.fee_multiplier || 1);
  const pnl = won ? 1 - price - fee : -price - fee;
  const named = o.confluence?.long?.setup && o.confluence.long.setup !== "NONE"
    ? o.confluence.long.setup
    : o.confluence?.short?.setup && o.confluence.short.setup !== "NONE"
      ? o.confluence.short.setup
      : "settlement-model";
  const tte = typeof o.tte_s === "number" ? o.tte_s : 0;
  const fresh = (o.index_age_ms ?? 0) < 20_000 && (o.book_age_ms ?? 0) < 20_000;
  const at = Date.parse(o.ts ?? "") || 0;
  const expiryMs = Date.parse(o.close ?? "") || at;
  return {
    at,
    expiryMs,
    series: o.series,
    setup: named,
    modelPYes: p,
    yesPrice: mid,
    edge: buyYes ? p - price : 1 - p - price,
    mode: o.best?.mode === "maker" || o.best?.mode === "taker" ? o.best.mode : "none",
    featureHash: o.ticker,
    settledYes: yy,
    pnlAfterFees: Number(pnl.toFixed(4)),
    fresh,
    tteSec: tte,
    filled: false,
  };
}

/** Last usable print per ticker. Later lines replace earlier ones. */
export function lastPerTicker(decisions: RawDecision[], outcomes: Map<string, "yes" | "no">): DecisionRow[] {
  const last = new Map<string, RawDecision>();
  for (const o of decisions) {
    if (!o.ticker) continue;
    const q = o.quotes;
    if (typeof o.p !== "number" || typeof q?.yes_bid !== "number" || typeof q?.yes_ask !== "number") continue;
    last.set(o.ticker, o);
  }
  const out: DecisionRow[] = [];
  for (const [ticker, o] of last) {
    const row = toScoreRow(o, outcomes.get(ticker));
    if (row) out.push(row);
  }
  return out;
}

/** Every decision that has a probability and a price, joined to a later settlement. Repeats of one contract stay repeats. */
export function scoreableDecisions(decisions: RawDecision[], outcomes: Map<string, "yes" | "no">): { rows: DecisionRow[]; dropped: Record<string, number> } {
  const dropped: Record<string, number> = { no_ticker: 0, no_probability: 0, no_price: 0, no_settlement: 0 };
  const rows: DecisionRow[] = [];
  for (const o of decisions) {
    if (!o.ticker) {
      dropped.no_ticker += 1;
      continue;
    }
    if (typeof o.p !== "number") {
      dropped.no_probability += 1;
      continue;
    }
    const q = o.quotes;
    if (typeof q?.yes_bid !== "number" || typeof q?.yes_ask !== "number") {
      dropped.no_price += 1;
      continue;
    }
    const result = outcomes.get(o.ticker);
    if (result !== "yes" && result !== "no") {
      dropped.no_settlement += 1;
      continue;
    }
    const row = toScoreRow(o, result);
    if (row) rows.push(row);
    else dropped.no_price += 1;
  }
  return { rows, dropped };
}
