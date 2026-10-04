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
  /** Last 30 minutes of the official index. This picks the side. */
  bias30?: "up" | "down" | "flat" | null;
  /** Last finished minute is at least as wide as the two before it. */
  push?: boolean | null;
  /** Ticket volume. A note. The push above is the size check. */
  volume?: number | null;
  /** Last two ticket candles. A note. It does not block. */
  engulf?: "up" | "down" | null;
  fresh: boolean;
  /** CPI, NFP, or the Fed decision minute. Stand down. Not a direction. */
  blackout?: boolean;
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
    why,
  });

  const st = i.status.toLowerCase();
  if (st && st !== "active" && st !== "open") return sit("market not active");
  if (!(i.now >= i.openTs && i.now < i.closeTs)) return sit("market closed");
  if (i.leftSec < 90 || i.leftSec > 880) return sit("outside entry window");
  if (!i.fresh || !i.tapeOk) return sit("stale tape");
  if (settlement === "unknown") return sit("settlement rule unknown");
  if (i.spotSource !== settlement) return sit(`spot ${i.spotSource} ≠ ${settlement}`);
  if (!i.beat || !i.spot) return sit("no strike");

  const moveBps = ((i.spot - i.beat) / i.beat) * 10_000;
  const vol = i.volBps1m != null && i.volBps1m > 0 && i.volBps1m <= 200 ? i.volBps1m : null;
  if (vol == null) return sit("wiggle unreadable");
  if (i.leftSec <= 180 && Math.abs(moveBps) < vol * 2) return sit("too close to the line");
  const print: "up" | "down" = moveBps > 0 ? "up" : "down";
  const pushed = Math.abs(moveBps) > vol;
  const lean = i.bias30 === "up" || i.bias30 === "down" ? i.bias30 : pushed ? print : null;
  const cents = `up ${Math.round(i.yesAsk * 100)}¢ down ${Math.round(i.noAsk * 100)}¢`;
  if (!lean) return sit(`no push and no day lean · ${cents}`);

  const stretched = Math.abs(moveBps) > vol * 1.5;
  const stalledHigh = lean === "up" && (i.engulf === "down" || (i.push === false && print === "up" && stretched));
  const stalledLow = lean === "down" && (i.engulf === "up" || (i.push === false && print === "down" && stretched));
  let leg: "up" | "down" | null = null;
  let kind = "";
  if (stalledHigh && i.leftSec >= 180 && pushed) {
    leg = "down";
    kind = "counter";
  } else if (stalledLow && i.leftSec >= 180 && pushed) {
    leg = "up";
    kind = "counter";
  } else if (print === lean && pushed) {
    leg = lean;
    kind = "with";
  }
  if (!leg) return sit(`day lean ${lean} but this contract is not pushing · ${cents}`);
  if (i.volume === 0) return sit("no volume");

  const marketP = leg === "up" ? i.yesAsk : i.noAsk;
  const spread = i.yesBid > 0 ? Math.max(0, i.yesAsk - i.yesBid) : i.yesAsk;
  if (spread > 0.08) return sit("spread too wide");
  const catalyst = Boolean(i.blackout);
  const low = catalyst ? 0.2 : 0.25;
  const high = catalyst ? 0.4 : 0.45;
  if (marketP < low || marketP > high) return sit(`payout not worth it · ${cents}`);
  const fee = feeProb(marketP);
  const why = `${catalyst ? "catalyst " : ""}${kind} ${leg} · day ${lean} · index ${moveBps.toFixed(1)} bps · ticket ${(marketP * 100).toFixed(0)}¢ · take · fee ${(fee * 100).toFixed(1)}¢ · ${cents}`;
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
    why,
  };
}
