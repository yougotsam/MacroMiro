/** One live model per book. Shadow lanes must not call this to place orders. */

export const MIN_NET_EDGE = 0.03;
export const SAFETY_MARGIN = 0.01;
export const SLIPPAGE = 0.01;
export const STRATEGY_BTC = "btc-brti-vol-book";
export const STRATEGY_GOLD = "gold-pyth-vol-book";
export const STRATEGY_ETH = "eth-rti-vol-book";
export const STRATEGY_SOL = "sol-rti-vol-book";
export const STRATEGY_XRP = "xrp-rti-vol-book";

export type SpotSource = "cf-brti-60s" | "cf-eth-60s" | "cf-sol-60s" | "cf-xrp-60s" | "pyth-gold-1m" | "kalshi-perp" | "binance-us" | "none";

export type EdgeIn = {
  book: "btc" | "gold" | "eth" | "sol" | "xrp";
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
  /** CPI, NFP, or the Fed decision minute. Same 4¢–75¢ band. Does not raise the $5 cap. */
  blackout?: boolean;
  /** Official index socket is down. The Kalshi perp mark is the distance only. It does not settle the ticket. */
  fallback?: boolean;
};

export type EdgeOut = {
  take: boolean;
  leg: "up" | "down" | null;
  strategy: string;
  settlement: "cf-brti-60s" | "cf-eth-60s" | "cf-sol-60s" | "cf-xrp-60s" | "pyth-gold-1m" | "unknown";
  modelP: number | null;
  marketP: number | null;
  gross: number | null;
  net: number | null;
  fee: number | null;
  spread: number | null;
  /** True when the index has already broken the line. Cross the ask. Quiet books still rest. */
  cross: boolean;
  /** CPI, jobs, or the Fed minute. Same 4¢–75¢ band. Does not raise the $5 cap. */
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
  if (book === "xrp" && t.includes("cf benchmarks") && t.includes("xrp")) return "cf-xrp-60s";
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

export interface TechnicalFrame {
  spot: number;
  strike: number;
  noise1m: number;
  rsi14?: number;
  ema20?: number;
  ema50?: number;
  fib618?: number;
  candle: {
    open: number;
    high: number;
    low: number;
    close: number;
    isEngulfingBull?: boolean;
    isEngulfingBear?: boolean;
    /** (min(open, close) - low) / (high - low) */
    lowerWickRatio?: number;
    /** (high - max(open, close)) / (high - low) */
    upperWickRatio?: number;
  };
  spot30sAgo?: number;
}

/** Rebuild the frame from a flat edge row. The live scan passes a real frame instead. */
export function frameFromEdge(i: EdgeIn): TechnicalFrame {
  const spot = i.spot ?? 0;
  const bull = i.rejection === "up" || i.engulf === "up";
  const bear = i.rejection === "down" || i.engulf === "down";
  return {
    spot,
    strike: i.beat,
    noise1m: i.volBps1m != null && i.volBps1m > 0 && spot > 0 ? (i.volBps1m / 10_000) * spot : 0,
    rsi14: i.rsi ?? undefined,
    ema20: i.ema20 ?? undefined,
    ema50: i.ema50 ?? undefined,
    fib618: i.fibZone === "618" ? spot : undefined,
    candle: {
      open: spot,
      high: spot,
      low: spot,
      close: spot,
      isEngulfingBull: i.engulf === "up" ? true : undefined,
      isEngulfingBear: i.engulf === "down" ? true : undefined,
      lowerWickRatio: bull ? 0.55 : 0,
      upperWickRatio: bear ? 0.55 : 0,
    },
    spot30sAgo: i.spot30 != null && i.spot30 > 0 ? i.spot30 : undefined,
  };
}

function structureCall(
  frame: TechnicalFrame,
  yesAsk: number,
  noAsk: number,
): { leg: "up" | "down"; code: string } | { sit: string } {
  const spot = frame.spot;
  const strike = frame.strike;
  if (!Number.isFinite(spot) || !Number.isFinite(strike)) return { sit: "wiggle unreadable" };
  if (spot === strike) return { sit: "on the line" };
  const rsi = frame.rsi14;
  const ago = frame.spot30sAgo;
  const notFalling = ago == null || spot >= ago;
  const notRising = ago == null || spot <= ago;
  const noise = Number.isFinite(frame.noise1m) ? frame.noise1m : 0;
  if (!(noise > 0)) return { sit: "wiggle unreadable" };
  if (Math.abs(spot - strike) < noise * 0.5) return { sit: "not clearing the line" };
  const sideUp = spot > strike;
  const floor = ago ?? spot - 0.5 * noise;
  const ceil = ago ?? spot + 0.5 * noise;
  const yesRegime =
    frame.ema20 == null || spot >= frame.ema20 || (frame.ema50 != null && frame.ema20 > frame.ema50);
  const noRegime =
    frame.ema20 == null || spot <= frame.ema20 || (frame.ema50 != null && frame.ema20 < frame.ema50);
  const lower = frame.candle.lowerWickRatio ?? 0;
  const upper = frame.candle.upperWickRatio ?? 0;
  const aboveFibOrStrike = frame.fib618 != null ? spot >= frame.fib618 || spot >= strike : spot >= strike;
  const belowFibOrStrike = frame.fib618 != null ? spot <= frame.fib618 || spot <= strike : spot <= strike;
  const yesWick =
    yesRegime &&
    yesAsk >= 0.04 &&
    yesAsk <= 0.35 &&
    (rsi == null || rsi <= 38) &&
    (lower >= 0.4 || frame.candle.isEngulfingBull === true) &&
    aboveFibOrStrike;
  const noWick =
    noRegime &&
    noAsk >= 0.04 &&
    noAsk <= 0.35 &&
    (rsi == null || rsi >= 62) &&
    (upper >= 0.4 || frame.candle.isEngulfingBear === true) &&
    belowFibOrStrike;
  const yesBreak = yesRegime && spot >= strike && spot >= floor && (rsi == null || (rsi >= 48 && rsi <= 78));
  const noBreak = noRegime && spot <= strike && spot <= ceil && (rsi == null || rsi <= 52);
  const yesExhaust = sideUp && rsi != null && rsi > 78;
  if (sideUp && !notFalling) return { sit: "SIT: momentum_against" };
  if (!sideUp && !notRising) return { sit: "SIT: momentum_against" };
  if (yesExhaust) return { sit: "SIT: rsi_exhaustion" };
  if (sideUp && yesWick) return { leg: "up", code: "YES: wick_reversal_fib" };
  if (!sideUp && noWick) return { leg: "down", code: "NO: wick_rejection_fib" };
  if (sideUp && yesBreak) return { leg: "up", code: "YES: trend_breakout_rsi" };
  if (!sideUp && noBreak) return { leg: "down", code: "NO: trend_breakdown_rsi" };
  if (sideUp) return { leg: "up", code: "YES: index_side" };
  return { leg: "down", code: "NO: index_side" };
}

export function edgeDecision(i: EdgeIn): EdgeOut {
  return evaluateEdge(i, frameFromEdge(i));
}

/** 15-minute ticket. The frame decides. Spread width does not. Price stays 4¢–75¢. */
export function evaluateEdge(i: EdgeIn, frame: TechnicalFrame): EdgeOut {
  const strategy =
    i.book === "btc" ? STRATEGY_BTC : i.book === "eth" ? STRATEGY_ETH : i.book === "sol" ? STRATEGY_SOL : i.book === "xrp" ? STRATEGY_XRP : STRATEGY_GOLD;
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

  if (i.volBps1m != null && i.volBps1m > 200) return sit("volatility extreme");
  const cents = `up ${Math.round(i.yesAsk * 100)}¢ down ${Math.round(i.noAsk * 100)}¢`;
  const call = structureCall(frame, i.yesAsk, i.noAsk);
  if ("sit" in call) return sit(`${call.sit} · ${cents}`);

  const leg = call.leg;
  const matched = i.bias30 === leg;
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
  const why = `${catalyst ? "catalyst " : ""}${call.code}${clipScale < 1 ? " · half clip" : ""}${bridge ? " · perp tape" : ""} · day ${day} · fee ${(fee * 100).toFixed(1)}¢ · ticket ${(marketP * 100).toFixed(0)}¢ · ${cents}`;
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
