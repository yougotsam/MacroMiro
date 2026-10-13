/**
 * PERPS_SCALPER candidate engine (research only). Reuses the sniper evaluator and its confirmed swings; does NOT
 * reuse the binary settlement-probability model. Output is a plan + after-cost math + gates; decision is never
 * TRADE (no live path exists). Win probability is unknown, so we report the break-even win rate instead of an EV.
 */
import { atr, confirmedSwings, evaluateSniper, type Candle } from "@/lib/desk/sniper";
import type { Book, PerpMarket } from "./kalshi-perps-read";

export const PERPS_CANDIDATE_SCHEMA = "perps-candidate/v1";
export type PerpsParams = { riskUsd: number; maxNotionalUsd: number; holdHours: number; maxFundingAgainst: number; minDepthMultiple: number; macroClear: boolean };
export const DEFAULT_PARAMS: PerpsParams = { riskUsd: 1, maxNotionalUsd: 100, holdHours: 1, maxFundingAgainst: 0.0005, minDepthMultiple: 3, macroClear: false };

export type PerpsCandidate = {
  schema: string; ticker: string; dir: "long" | "short"; observedAt: string; decidedAt: string;
  setup: string; score: number; scoreState: "NOT_READY" | "VALID_SCORE"; missing: string[];
  bestBid: number | null; bestAsk: number | null; spreadPct: number | null;
  entry: number | null; entryType: "post_only_limit"; stop: number | null; stopBasis: string; target1: number | null; target2: number | null;
  qtyContracts: number; notionalUsd: number; riskUsd: number;
  fees: { makerRate: number; takerRate: number }; funding: { rate8h: number; nextFundingAt: string; costPctOverHold: number };
  costs: { winCostUsd: number; lossCostUsd: number }; payoff: { winUsdNet: number; lossUsdNet: number; breakEvenWinRate: number | null };
  gates: Record<string, { pass: boolean; why: string }>; decision: "NO_TRADE" | "RESEARCH_CANDIDATE"; reason: string;
};

/** Drop impossible bars (data_ready tolerates at most 2% dropped, else NOT ready).
 * Drop impossible bars (zero/negative prices, or a high/low more than 20% from the median close). */
export function cleanBars(b: Candle[]): { bars: Candle[]; dropped: number } {
  const cs = b.map((x) => x.c).filter((x) => x > 0).sort((p, q) => p - q);
  const med = cs.length ? cs[Math.floor(cs.length / 2)] : 0;
  const bars = b.filter((x) => x.l > 0 && x.o > 0 && x.c > 0 && x.h >= x.l && med > 0 && x.h <= med * 1.2 && x.l >= med * 0.8);
  return { bars, dropped: b.length - bars.length };
}

export function buildPerpsCandidate(input: {
  market: PerpMarket; book: Book; b15: Candle[]; b1h: Candle[]; dir: "long" | "short"; makerRate: number; takerRate: number;
  fundingRate8h: number; nextFundingMs: number; observedMs: number; params?: Partial<PerpsParams>;
}): PerpsCandidate {
  const p = { ...DEFAULT_PARAMS, ...input.params };
  const { market: m, book, dir } = input;
  const c15 = cleanBars(input.b15), c1h = cleanBars(input.b1h);
  input = { ...input, b15: c15.bars, b1h: c1h.bars };
  const e = evaluateSniper(input.b15, input.b1h, dir, p.macroClear);
  const ready = !e.missing.some((x) => /complete 15m bars|complete 1h bars/.test(x));
  const long = dir === "long";
  // venue price scale: perps quote = underlying × contract size; candles are already venue prices (same scale)
  const entry = long ? book.bestBid : book.bestAsk; // maker: join our side of the book (post-only)
  const a = atr(input.b15);
  const sw = confirmedSwings(input.b15);
  let stop: number | null = null, stopBasis = "none";
  if (entry != null && a != null && a > 0) {
    const swing = long ? sw.lows.filter((x) => x.price < entry).at(-1) : sw.highs.filter((x) => x.price > entry).at(-1);
    if (swing && Math.abs(entry - swing.price) <= 3 * a && Math.abs(entry - swing.price) >= 0.5 * a) { stop = long ? swing.price - 0.1 * a : swing.price + 0.1 * a; stopBasis = "last confirmed 15m swing ± 0.1 ATR"; }
    else { stop = long ? entry - a : entry + a; stopBasis = "1 ATR(15m) — no confirmed swing 0.5–3 ATR away"; }
  }
  const r = entry != null && stop != null ? Math.abs(entry - stop) : null;
  const target1 = entry != null && r ? +(long ? entry + r : entry - r).toFixed(4) : null;
  const target2 = entry != null && r ? +(long ? entry + 2 * r : entry - 2 * r).toFixed(4) : null;
  // size: whole contracts so that stop distance × qty ≈ riskUsd (price units are dollars per contract)
  const qtyRisk = r && r > 0 ? Math.max(0, Math.floor(p.riskUsd / r)) : 0;
  const qty = entry ? Math.min(qtyRisk, Math.floor(p.maxNotionalUsd / entry)) : 0;
  const notional = entry != null ? +(qty * entry).toFixed(2) : 0;
  const spreadPct = book.bestBid && book.bestAsk ? ((book.bestAsk - book.bestBid) / ((book.bestAsk + book.bestBid) / 2)) * 100 : null;
  // funding: positive rate → longs pay shorts, per 8 h, prorated over the planned hold
  const fundingPct = (long ? 1 : -1) * input.fundingRate8h * (p.holdHours / 8);
  // win path: maker in, half off at T1 and half at T2 as maker limits; loss path: maker in, taker stop + one tick slip
  const winGross = r ? qty * (0.5 * r + 0.5 * 2 * r) : 0;
  const winCost = notional * (input.makerRate * 2) + notional * fundingPct;
  const lossGross = r ? qty * r : 0;
  const lossCost = notional * (input.makerRate + input.takerRate) + qty * m.tick + notional * fundingPct;
  const winNet = +(winGross - winCost).toFixed(4), lossNet = +(-(lossGross + lossCost)).toFixed(4);
  const be = winNet > 0 ? +(-lossNet / (winNet - lossNet)).toFixed(4) : null;
  const sideDepth = (long ? book.bids : book.asks).slice(0, 5).reduce((s, x) => s + x[1], 0);
  const stopSideDepth = (long ? book.bids : book.asks).filter((x) => (long ? x[0] >= (stop ?? 0) : x[0] <= (stop ?? Infinity))).reduce((s, x) => s + x[1], 0);
  const gates = {
    data_ready: { pass: ready && c15.dropped + c1h.dropped <= Math.max(1, Math.floor(0.02 * (input.b15.length + input.b1h.length))), why: (ready ? "60×15m + 205×1h bars" : e.missing.join("; ")) + (c15.dropped + c1h.dropped ? `; dropped ${c15.dropped + c1h.dropped} impossible bars` : "") },
    setup: { pass: e.setup !== "NONE", why: e.setup },
    confluence_9: { pass: e.eligible, why: `${e.score}/13${e.eligible ? " eligible" : ""}` },
    funding: { pass: long ? input.fundingRate8h <= p.maxFundingAgainst : input.fundingRate8h >= -p.maxFundingAgainst, why: `rate ${input.fundingRate8h} per 8h (${long ? "longs pay if +" : "shorts pay if −"})` },
    depth: { pass: qty > 0 && stopSideDepth >= p.minDepthMultiple * qty, why: `${stopSideDepth} contracts between entry and stop on our side vs need ${p.minDepthMultiple}×${qty}` },
    size: { pass: qty >= 1, why: qty >= 1 ? `${qty} contracts (risk cap ${qtyRisk}, notional cap $${p.maxNotionalUsd})` : `stop distance ${r?.toFixed(4)} > risk $${p.riskUsd} per contract` },
    after_cost_positive_payoff: { pass: winNet > 0, why: `win ${winNet} / loss ${lossNet}` },
  };
  const failed = Object.entries(gates).filter(([, g]) => !g.pass).map(([k]) => k);
  return {
    schema: PERPS_CANDIDATE_SCHEMA, ticker: m.ticker, dir, observedAt: new Date(input.observedMs).toISOString(), decidedAt: new Date().toISOString(),
    setup: e.setup, score: e.score, scoreState: ready ? "VALID_SCORE" : "NOT_READY", missing: e.missing,
    bestBid: book.bestBid, bestAsk: book.bestAsk, spreadPct: spreadPct == null ? null : +spreadPct.toFixed(4),
    entry, entryType: "post_only_limit", stop: stop == null ? null : +stop.toFixed(4), stopBasis, target1, target2,
    qtyContracts: qty, notionalUsd: notional, riskUsd: r ? +(qty * r).toFixed(4) : 0,
    fees: { makerRate: input.makerRate, takerRate: input.takerRate },
    funding: { rate8h: input.fundingRate8h, nextFundingAt: new Date(input.nextFundingMs).toISOString(), costPctOverHold: +(fundingPct * 100).toFixed(5) },
    costs: { winCostUsd: +winCost.toFixed(4), lossCostUsd: +lossCost.toFixed(4) }, payoff: { winUsdNet: winNet, lossUsdNet: lossNet, breakEvenWinRate: be },
    gates, decision: failed.length ? "NO_TRADE" : "RESEARCH_CANDIDATE",
    reason: failed.length ? `failed: ${failed.join(", ")}` : "all research gates pass (paper only; live orders locked; win probability not yet measured)",
  };
}
