/**
 * PERPS_SCALPER candidate engine (research only). Reuses the sniper evaluator and its confirmed swings; does NOT
 * reuse the binary settlement-probability model. Output is a plan + after-cost math + gates; decision is never
 * TRADE (no live path exists). Win probability is unknown, so we report the break-even win rate instead of an EV.
 */
import { atr, confirmedSwings, evaluateSniper, type Candle } from "@/lib/desk/sniper";
import type { Book, PerpMarket } from "./kalshi-perps-read";

export const PERPS_CANDIDATE_SCHEMA = "perps-candidate/v2";
export type PerpsParams = { riskUsd: number; maxNotionalUsd: number; holdHours: number; maxFundingAgainst: number; minDepthMultiple: number; macroClear: boolean };
export const RESEARCH_CLIP_ID = "research-clip/not-a-mandate";
/** Dollar probe only. These $1 / $100 numbers match the rejected conservative record. They are not aggressive-experimental/v1 and they are not a live approval. */
export const DEFAULT_PARAMS: PerpsParams = { riskUsd: 1, maxNotionalUsd: 100, holdHours: 1, maxFundingAgainst: 0.0005, minDepthMultiple: 3, macroClear: false };

export type PerpsCandidate = {
  schema: string; ticker: string; dir: "long" | "short"; observedAt: string; receivedAt: string; decidedAt: string;
  bookKind: "venue" | "synthetic_candle"; executionClass: "venue_book" | "candle_proxy_not_a_fill";
  setup: string; score: number; scoreState: "NOT_READY" | "VALID_SCORE"; missing: string[];
  bestBid: number | null; bestAsk: number | null; spreadPct: number | null;
  entry: number | null; entryType: "post_only_limit"; stop: number | null; stopBasis: string; target1: number | null; target2: number | null;
  qtyContracts: number; notionalUsd: number; riskUsd: number;
  fees: { makerRate: number; takerRate: number };
  funding: { known: boolean; rate8h: number | null; nextFundingAt: string; costPctOverHold: number | null };
  costs: { winCostUsd: number | null; lossCostUsd: number | null };
  payoff: { winUsdNet: number | null; lossUsdNet: number | null; breakEvenWinRate: number | null; winProbability: null; winProbabilityState: "UNKNOWN" };
  gates: Record<string, { pass: boolean; why: string }>; decision: "NO_TRADE" | "RESEARCH_CANDIDATE"; reason: string;
  /** caller = the trace passed receipt and decision times. construction_clock = those times were missing, so they are "now", not the request start. */
  timeSource: "caller" | "construction_clock";
  sizingProfile: string;
};

/** Drop impossible bars (data_ready tolerates at most 2% dropped, else NOT ready).
 * Drop impossible bars (zero/negative prices, or a high/low more than 20% from the median close). */
export function cleanBars(b: Candle[]): { bars: Candle[]; dropped: number } {
  const cs = b.map((x) => x.c).filter((x) => x > 0).sort((p, q) => p - q);
  const med = cs.length ? cs[Math.floor(cs.length / 2)] : 0;
  const bars = b.filter((x) => x.l > 0 && x.o > 0 && x.c > 0 && x.h >= x.l && med > 0 && x.h <= med * 1.2 && x.l >= med * 0.8);
  return { bars, dropped: b.length - bars.length };
}

/** How many 8-hour funding prints fall inside the hold, starting at the venue's next funding time. A print counts in full. A fraction of the rate is not a charge. */
export function fundingPrintsInHold(nextFundingMs: number, fromMs: number, holdHours: number): number {
  if (!Number.isFinite(nextFundingMs) || !Number.isFinite(fromMs) || !(holdHours > 0)) return 0;
  const end = fromMs + holdHours * 3_600_000;
  let t = nextFundingMs;
  let guard = 0;
  while (t <= fromMs && guard++ < 12) t += 8 * 3_600_000;
  let n = 0;
  while (t > fromMs && t <= end && n < 8) { n++; t += 8 * 3_600_000; }
  return n;
}

export function buildPerpsCandidate(input: {
  market: PerpMarket; book: Book; b15: Candle[]; b1h: Candle[]; dir: "long" | "short"; makerRate: number; takerRate: number;
  fundingRate8h: number | null; nextFundingMs: number; observedMs: number; receivedMs?: number; decisionMs?: number;
  bookKind?: "venue" | "synthetic_candle"; params?: Partial<PerpsParams>;
  bookFresh?: boolean; tradingActive?: boolean; sizingProfile?: string;
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
  const bookKind = input.bookKind ?? "venue";
  const rate = input.fundingRate8h;
  const fundingKnown = rate != null && Number.isFinite(rate);
  const prints = fundingPrintsInHold(input.nextFundingMs, input.decisionMs ?? input.observedMs, p.holdHours);
  const fundingPct = fundingKnown ? (long ? 1 : -1) * rate * prints : null;
  const winGross = r ? qty * (0.5 * r + 0.5 * 2 * r) : 0;
  const winCost = fundingKnown ? notional * (input.makerRate * 2) + notional * fundingPct! : null;
  const lossGross = r ? qty * r : 0;
  const lossCost = fundingKnown ? notional * (input.makerRate + input.takerRate) + qty * m.tick + notional * fundingPct! : null;
  const winNet = fundingKnown ? +(winGross - winCost!).toFixed(4) : null;
  const lossNet = fundingKnown ? +(-(lossGross + lossCost!)).toFixed(4) : null;
  const be = fundingKnown && winNet != null && lossNet != null && winNet > 0 ? +(-lossNet / (winNet - lossNet)).toFixed(4) : null;
  const stopSideDepth = (long ? book.bids : book.asks).filter((x) => (long ? x[0] >= (stop ?? 0) : x[0] <= (stop ?? Infinity))).reduce((s, x) => s + x[1], 0);
  const synthetic = bookKind === "synthetic_candle";
  const gates = {
    data_ready: { pass: ready && c15.dropped + c1h.dropped <= Math.max(1, Math.floor(0.02 * (input.b15.length + input.b1h.length))), why: (ready ? "60×15m + 205×1h bars" : e.missing.join("; ")) + (c15.dropped + c1h.dropped ? `; dropped ${c15.dropped + c1h.dropped} impossible bars` : "") },
    setup: { pass: e.setup !== "NONE", why: e.setup },
    confluence_9: { pass: e.eligible, why: `${e.score}/13${e.eligible ? " eligible" : ""}` },
    funding: { pass: fundingKnown && (long ? rate! <= p.maxFundingAgainst : rate! >= -p.maxFundingAgainst), why: fundingKnown ? `${prints} print(s) at rate ${rate} per 8h` : "funding unknown at decision time (not treated as zero)" },
    depth: { pass: !synthetic && qty > 0 && stopSideDepth >= p.minDepthMultiple * qty, why: synthetic ? "synthetic candle book is not executable depth" : `${stopSideDepth} contracts between entry and stop on our side vs need ${p.minDepthMultiple}×${qty}` },
    size: { pass: qty >= 1, why: qty >= 1 ? `${qty} contracts (risk cap ${qtyRisk}, notional cap $${p.maxNotionalUsd})` : `stop distance ${r?.toFixed(4)} > risk $${p.riskUsd} per contract` },
    after_cost_positive_payoff: { pass: fundingKnown && winNet != null && winNet > 0, why: fundingKnown ? `win ${winNet} / loss ${lossNet}` : "payoff not estimated; funding missing" },
    book_fresh: { pass: input.bookFresh !== false, why: input.bookFresh === false ? "book snapshot is stale or was taken before the candle pull" : "fresh, or the caller did not check" },
    market_open: { pass: input.tradingActive !== false && (!m.status || m.status === "active"), why: m.status && m.status !== "active" ? `market status ${m.status}` : input.tradingActive === false ? "trading_active is false" : "open, or the caller did not check" },
  };
  const failed = Object.entries(gates).filter(([, g]) => !g.pass).map(([k]) => k);
  const eventAt = new Date(input.observedMs).toISOString();
  const stamped = input.receivedMs != null && input.decisionMs != null;
  const receivedAt = new Date(stamped ? input.receivedMs! : Date.now()).toISOString();
  const decidedAt = new Date(stamped ? input.decisionMs! : Date.now()).toISOString();
  return {
    schema: PERPS_CANDIDATE_SCHEMA, ticker: m.ticker, dir, observedAt: eventAt, receivedAt, decidedAt,
    bookKind, executionClass: synthetic ? "candle_proxy_not_a_fill" : "venue_book",
    setup: e.setup, score: e.score, scoreState: ready ? "VALID_SCORE" : "NOT_READY", missing: e.missing,
    bestBid: book.bestBid, bestAsk: book.bestAsk, spreadPct: spreadPct == null ? null : +spreadPct.toFixed(4),
    entry, entryType: "post_only_limit", stop: stop == null ? null : +stop.toFixed(4), stopBasis, target1, target2,
    qtyContracts: qty, notionalUsd: notional, riskUsd: r ? +(qty * r).toFixed(4) : 0,
    fees: { makerRate: input.makerRate, takerRate: input.takerRate },
    funding: { known: fundingKnown, rate8h: fundingKnown ? rate : null, nextFundingAt: new Date(input.nextFundingMs).toISOString(), costPctOverHold: fundingPct == null ? null : +(fundingPct * 100).toFixed(5) },
    costs: { winCostUsd: winCost == null ? null : +winCost.toFixed(4), lossCostUsd: lossCost == null ? null : +lossCost.toFixed(4) },
    payoff: { winUsdNet: winNet, lossUsdNet: lossNet, breakEvenWinRate: be, winProbability: null, winProbabilityState: "UNKNOWN" },
    gates, decision: failed.length ? "NO_TRADE" : "RESEARCH_CANDIDATE",
    reason: failed.length ? `failed: ${failed.join(", ")}` : "all research gates pass (paper only; live orders locked; win probability UNKNOWN — break-even is not a win rate)",
    timeSource: stamped ? "caller" : "construction_clock",
    sizingProfile: input.sizingProfile ?? RESEARCH_CLIP_ID,
  };
}
