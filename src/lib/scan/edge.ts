/** One live model per book. Shadow lanes must not call this to place orders. */

export const MIN_NET_EDGE = 0.03;
export const SAFETY_MARGIN = 0.01;
export const SLIPPAGE = 0.01;
export const STRATEGY_BTC = "btc-brti-vol-book";
export const STRATEGY_GOLD = "gold-pyth-vol-book";
export const STRATEGY_ETH = "eth-rti-vol-book";
export const STRATEGY_SOL = "sol-rti-vol-book";

export type SpotSource = "cf-brti-60s" | "cf-eth-60s" | "cf-sol-60s" | "pyth-gold-1m" | "kalshi-perp" | "binance-us" | "none";

export type EdgeIn = {
  book: "btc" | "gold" | "eth" | "sol";
  status: string;
  leftSec: number;
  openTs: number;
  closeTs: number;
  now: number;
  beat: number;
  spot: number | null;
  spotSource: SpotSource;
  rules: string;
  yesAsk: number;
  yesBid: number;
  noAsk: number;
  volBps1m: number | null;
  tapeOk: boolean;
  newsOk: boolean;
  bookImb: number | null;
  rsi: number | null;
  bbWidth: number | null;
  fibZone: "none" | "236" | "382" | "500" | "618" | null;
  ema7: number | null;
  ema14: number | null;
  /** 1-minute settlement index. Continuation needs price on the correct side of this. */
  ema20?: number | null;
  /** 1-minute settlement index. Confirms the 20 when both exist. */
  ema50?: number | null;
  /** Wick rejection on the last finished index candle. */
  rejection?: "up" | "down" | null;
  /** Last 30 minutes of the official index. Sizes the clip. Does not pick the side. */
  bias30?: "up" | "down" | "flat" | null;
  /** Last finished minute is at least as wide as the two before it. */
  push?: boolean | null;
  /** Ticket volume. A note only. It does not sit the contract. */
  volume?: number | null;
  /** Last two ticket candles. Counter-trend only, when they flip against the lean. */
  engulf?: "up" | "down" | null;
  fresh: boolean;
  /** Same index, about 30 seconds earlier. Missing means use the distance hurdle. */
  spot30?: number | null;
  /** CPI, NFP, or the Fed decision minute. Same 4¢–75¢ band. Four times the clip. Not a direction. */
  blackout?: boolean;
  /** Official index socket is down. The Kalshi perp mark is the distance only. It does not settle the ticket. */
  fallback?: boolean;
};

export type EdgeOut = {
  take: boolean;
  leg: "up" | "down" | null;
  strategy: string;
  settlement: "cf-brti-60s" | "cf-eth-60s" | "cf-sol-60s" | "pyth-gold-1m" | "unknown";
  modelP: number | null;
  marketP: number | null;
  gross: number | null;
  net: number | null;
  fee: number | null;
  spread: number | null;
  /** True when the index has already broken the line. Cross the ask. Quiet books still rest. */
  cross: boolean;
  /** CPI, jobs, or the Fed minute. Cheap ticket, four times the clip. Not a sit. */
  catalyst: boolean;
  /** 1 when the 30-minute lean matches the print. 0.5 when that lean is flat, opposed, or the tape is the perp mark. */
  clipScale: number;
  why: string;
};

export function settlementOf(rules: string, book: EdgeIn["book"]): EdgeOut["settlement"] {
  const t = rules.toLowerCase();
  if (book === "btc" && t.includes("cf benchmarks") && t.includes("brti")) return "cf-brti-60s";
  if (book === "eth" && t.includes("cf benchmarks") && t.includes("eth")) return "cf-eth-60s";
  if (book === "sol" && t.includes("cf benchmarks") && t.includes("sol")) return "cf-sol-60s";
  if (book === "gold" && t.includes("pyth") && t.includes("gold")) return "pyth-gold-1m";
  return "unknown";
}

/** A filled ticket is held to the clock. Crossing the line is not a sell. */
export function reasonDead(_leg: "up" | "down", _spot: number, _beat: number, _stillTake: boolean) {
  return false;
}

function feeProb(p: number) {
  const x = Math.min(0.99, Math.max(0.01, p));
  return Math.ceil(0.07 * x * (1 - x) * 100) / 100;
}

export function edgeDecision(i: EdgeIn): EdgeOut {
  const strategy =
    i.book === "btc" ? STRATEGY_BTC : i.book === "eth" ? STRATEGY_ETH : i.book === "sol" ? STRATEGY_SOL : STRATEGY_GOLD;
  const settlement = settlementOf(i.rules, i.book);
  const sit = (why: string): EdgeOut => ({
    take: false,
    leg: null,
    strategy,
    settlement,
    modelP: null,
    marketP: null,
    gross: null,
    net: null,
    fee: null,
    spread: null,
    cross: false,
    catalyst: false,
    clipScale: 1,
    why,
  });

  const st = i.status.toLowerCase();
  if (st && st !== "active" && st !== "open") return sit("market not active");
  if (!(i.now >= i.openTs && i.now < i.closeTs)) return sit("market closed");
  if (i.leftSec <= 30 || i.leftSec > 895) return sit("outside entry window");
  if (!i.fresh || !i.tapeOk) return sit("stale tape");
  if (settlement === "unknown") return sit("settlement rule unknown");
  const bridge = Boolean(i.fallback) && i.spotSource === "kalshi-perp";
  if (i.spotSource !== settlement && !bridge) return sit(`spot ${i.spotSource} ≠ ${settlement}`);
  if (!i.beat || !i.spot) return sit("no strike");

  const moveBps = ((i.spot - i.beat) / i.beat) * 10_000;
  if (i.volBps1m != null && i.volBps1m > 200) return sit("volatility extreme");
  const vol = i.volBps1m != null && i.volBps1m > 0 && i.volBps1m <= 200 ? i.volBps1m : null;
  const cents = `up ${Math.round(i.yesAsk * 100)}¢ down ${Math.round(i.noAsk * 100)}¢`;
  const above = i.spot > i.beat;
  const below = i.spot < i.beat;
  const ema20 = i.ema20 ?? null;
  const ema50 = i.ema50 ?? null;
  const rsi = i.rsi;
  const rejection = i.rejection ?? null;
  const engulf = i.engulf ?? null;
  if (rsi == null && ema20 == null) return sit("indicators unread");

  const upTrend = ema20 != null && i.spot > ema20 && (ema50 == null || ema20 >= ema50) && above;
  const downTrend = ema20 != null && i.spot < ema20 && (ema50 == null || ema20 <= ema50) && below;
  const bullCandle = rejection === "up" || engulf === "up";
  const bearCandle = rejection === "down" || engulf === "down";
  const fib = i.fibZone === "618";
  let print: "up" | "down";
  let tech: string;
  if (rsi != null && rsi < 30 && bullCandle) {
    print = "up";
    tech = `YES: RSI bounce at ${rsi.toFixed(0)} + ${rejection === "up" ? "bullish rejection" : "bullish engulf"}`;
  } else if (rsi != null && rsi > 70 && bearCandle) {
    print = "down";
    tech = `NO: RSI fade at ${rsi.toFixed(0)} + ${rejection === "down" ? "bearish rejection" : "bearish engulf"}`;
  } else if (fib && (bullCandle || (ema20 != null && i.spot > ema20))) {
    print = "up";
    tech = "YES: fib 0.618 bounce";
  } else if (fib && (bearCandle || (ema20 != null && i.spot < ema20))) {
    print = "down";
    tech = "NO: fib 0.618 bounce";
  } else if (upTrend && rsi != null && rsi >= 70) {
    return sit("SIT: RSI overbought, no continuation");
  } else if (downTrend && rsi != null && rsi <= 30) {
    return sit("SIT: RSI oversold, no continuation");
  } else if (upTrend) {
    if (i.leftSec <= 60 && vol != null && Math.abs(moveBps) < vol * 0.5) return sit("too close to the line");
    print = "up";
    tech = `YES: 20-EMA breakout + RSI ${rsi == null ? "n/a" : rsi.toFixed(0)}`;
  } else if (downTrend) {
    if (i.leftSec <= 60 && vol != null && Math.abs(moveBps) < vol * 0.5) return sit("too close to the line");
    print = "down";
    tech = `NO: 20-EMA breakdown + RSI ${rsi == null ? "n/a" : rsi.toFixed(0)}`;
  } else {
    return sit("SIT: no structure");
  }

  const leg = print;
  const matched = i.bias30 === print;
  let clipScale = matched ? 1 : 0.5;
  if (bridge) clipScale = 0.5;

  if (!(i.yesAsk > 0 && i.yesBid > 0)) return sit(`no quote · ${cents}`);
  const spread = i.yesAsk - i.yesBid;
  const catalyst = Boolean(i.blackout);
  const low = 0.04;
  const high = 0.75;
  const marketP = leg === "up" ? i.yesAsk : i.noAsk;
  if (marketP < low || marketP > high) return sit(`payout not worth it · ${cents}`);
  const fee = feeProb(marketP);
  const day = i.bias30 === "up" || i.bias30 === "down" || i.bias30 === "flat" ? i.bias30 : "none";
  const why = `${catalyst ? "catalyst " : ""}${tech}${clipScale < 1 ? " · half clip" : ""}${bridge ? " · perp tape" : ""} · day ${day} · fee ${(fee * 100).toFixed(1)}¢ · ticket ${(marketP * 100).toFixed(0)}¢ · ${cents}`;
  return {
    take: true,
    leg,
    strategy,
    settlement,
    modelP: null,
    marketP: Number(marketP.toFixed(4)),
    gross: null,
    net: null,
    fee,
    spread: Number(spread.toFixed(4)),
    cross: true,
    catalyst,
    clipScale,
    why,
  };
}

export type PerpTicker =
  | "KXGOLDPERP"
  | "KXSILVERPERP"
  | "KXBTCPERP"
  | "KXETHPERP"
  | "KXSOLPERP"
  | "KXXRPPERP"
  | "KXBNBPERP"
  | "KXUS500PERP";

export interface PerpMarketState {
  ticker: PerpTicker;
  markPrice: number;
  bidPrice: number;
  askPrice: number;
  indexPrice: number;
  spreadBps: number;
  maxLeverage: number;
  fundingRateBps: number;
  dailyPnLUsd: number;
}

export interface UserCockpitConfig {
  selectedLeverage: number;
  clipUsd: number;
  tpMultiple: number;
  slPercent: number; // 8 means 8 percent of the clip, same as the cockpit
  tauricThreshold: number;
}

export interface TauricSignal {
  direction: "LONG" | "SHORT" | "NEUTRAL";
  confidenceScore: number;
  catalystAlert: boolean;
  primaryThesis: string;
}

export interface KalshiBracketOrder {
  ticker: PerpTicker;
  side: "bid" | "ask";
  count: string;
  entryPrice: string;
  takeProfitPrice: string;
  stopLossPrice: string;
  effectiveLeverage: number;
  requiredMarginUsd: number;
  notionalUsd: number;
  liquidationDistancePercent: number;
}

export interface EdgeDecision {
  action: "EXECUTE" | "SKIP";
  reason: string;
  order?: KalshiBracketOrder;
}

/** Single source of truth decision loop */
export function evaluatePerpEdge(market: PerpMarketState, tauric: TauricSignal, config: UserCockpitConfig): EdgeDecision {
  if (tauric.catalystAlert) {
    return { action: "SKIP", reason: "Catalyst blackout active: High volatility window" };
  }

  if (market.dailyPnLUsd <= -24.0) {
    return { action: "SKIP", reason: "Daily loss shield tripped (-$24 cap reached). Cool off active." };
  }

  if (tauric.direction === "NEUTRAL" || tauric.confidenceScore < config.tauricThreshold) {
    return {
      action: "SKIP",
      reason: `Tauric consensus score ${tauric.confidenceScore} is below threshold ${config.tauricThreshold}`,
    };
  }

  const effectiveLeverage = Math.min(Math.max(config.selectedLeverage, 1.0), market.maxLeverage);

  const notionalUsd = config.clipUsd * effectiveLeverage;
  const executionPrice = tauric.direction === "LONG" ? market.askPrice : market.bidPrice;

  if (executionPrice <= 0) {
    return { action: "SKIP", reason: "Invalid market price data" };
  }

  const rawCount = notionalUsd / executionPrice;
  const count = rawCount.toFixed(6);
  const actualNotional = parseFloat(count) * executionPrice;
  const requiredMargin = actualNotional / effectiveLeverage;
  const slPct = config.slPercent / 100;
  const priceMovePctForSL = slPct / effectiveLeverage;
  const priceMovePctForTP = (slPct * config.tpMultiple) / effectiveLeverage;

  let takeProfitPrice: number;
  let stopLossPrice: number;

  if (tauric.direction === "LONG") {
    takeProfitPrice = executionPrice * (1 + priceMovePctForTP);
    stopLossPrice = executionPrice * (1 - priceMovePctForSL);
  } else {
    takeProfitPrice = executionPrice * (1 - priceMovePctForTP);
    stopLossPrice = executionPrice * (1 + priceMovePctForSL);
  }

  const liquidationDistancePercent = (1 / effectiveLeverage) * 90;

  return {
    action: "EXECUTE",
    reason: `Tauric ${tauric.direction} signal confirmed (${tauric.confidenceScore}/100) at ${effectiveLeverage.toFixed(1)}x leverage`,
    order: {
      ticker: market.ticker,
      side: tauric.direction === "LONG" ? "bid" : "ask",
      count,
      entryPrice: executionPrice.toFixed(4),
      takeProfitPrice: takeProfitPrice.toFixed(4),
      stopLossPrice: stopLossPrice.toFixed(4),
      effectiveLeverage,
      requiredMarginUsd: Math.round(requiredMargin * 100) / 100,
      notionalUsd: Math.round(actualNotional * 100) / 100,
      liquidationDistancePercent: Math.round(liquidationDistancePercent * 10) / 10,
    },
  };
}
