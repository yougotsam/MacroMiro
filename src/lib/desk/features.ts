/**
 * Supporting features on the settlement index's own 1-minute bars (built from 1-second prints).
 * Four evidence groups, one vote each (no double counting). The shift is a log-odds step of at most 0.16, then cut at ±FEATURE_MAX_SHIFT.
 */
import { FEATURE_MAX_SHIFT } from "./config";
import type { Print } from "./settlement";
import { cvd, rvol, vwap, type Candle } from "./sniper";

export type Bar = { t: number; o: number; h: number; l: number; c: number };

export function minuteBars(prints: Print[], nowMs: number): Bar[] {
  const out: Bar[] = [];
  const curMin = Math.floor(nowMs / 60_000);
  for (const p of prints) {
    const m = Math.floor(p.t / 60_000);
    if (m >= curMin) continue; // closed bars only (no look-ahead)
    const last = out[out.length - 1];
    if (last && last.t === m) {
      last.h = Math.max(last.h, p.v);
      last.l = Math.min(last.l, p.v);
      last.c = p.v;
    } else out.push({ t: m, o: p.v, h: p.v, l: p.v, c: p.v });
  }
  return out;
}

export function ema(values: number[], n: number): number | null {
  if (values.length < n) return null;
  const k = 2 / (n + 1);
  let e = values.slice(0, n).reduce((a, b) => a + b, 0) / n;
  for (let i = n; i < values.length; i += 1) e = values[i] * k + e * (1 - k);
  return e;
}

export function rsi(values: number[], n = 14): number | null {
  if (values.length < n + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= n; i += 1) {
    const d = values[i] - values[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  gain /= n;
  loss /= n;
  for (let i = n + 1; i < values.length; i += 1) {
    const d = values[i] - values[i - 1];
    gain = (gain * (n - 1) + Math.max(0, d)) / n;
    loss = (loss * (n - 1) + Math.max(0, -d)) / n;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

const clamp1 = (x: number) => Math.max(-1, Math.min(1, x));

export type FeatureSnapshot = {
  bars: number;
  ema7: number | null;
  ema14: number | null;
  ema20: number | null;
  ema50: number | null;
  rsi14: number | null;
  ret5mBps: number | null;
  candle: string;
  structure: string;
  groups: { trend: number | null; momentum: number | null; structure: number | null; candle: number | null };
  /** Exchange flow. Null means the tape was not there. It is never stored as zero. */
  flow: FlowVote | null;
  score: number; // mean of available groups, [-1, 1], + = YES-leaning
};

export type FlowVote = {
  rvol: number | null;
  cvd: number | null;
  vwap: number | null;
  ofi: number | null;
  book: { bid: number; ask: number; imbalance: number } | null;
  source: string | null;
  stale: boolean;
  why: string | null;
};

export function features(bars: Bar[]): FeatureSnapshot {
  const closes = bars.map((b) => b.c);
  const e7 = ema(closes, 7);
  const e14 = ema(closes, 14);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const r = rsi(closes, 14);
  const last = bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const c5 = closes.length >= 6 ? closes[closes.length - 6] : null;
  const ret5 = c5 && last ? ((last.c - c5) / c5) * 10_000 : null;

  // TREND: EMA 7/14/50 stack (50 optional while warming)
  let trend: number | null = null;
  if (e7 != null && e14 != null) {
    trend = e7 > e14 ? 0.5 : e7 < e14 ? -0.5 : 0;
    if (e50 != null) {
      if (e7 > e14 && e14 > e50) trend = 1;
      else if (e7 < e14 && e14 < e50) trend = -1;
    }
  }
  // MOMENTUM: last 5 closed minutes of the settlement index. RSI is stored on the snapshot and does not vote.
  // Extreme RSI has no edge after multiple-testing correction, and this book was using it as a fade and a continuation at the same time.
  let momentum: number | null = null;
  if (ret5 != null) momentum = clamp1(ret5 / 10);
  else if (r != null) momentum = 0;
  // CANDLE: engulfing / rejection wick on the last closed bar
  let candle: number | null = null;
  let candleTag = "none";
  if (last && prev) {
    const body = Math.abs(last.c - last.o);
    const range = last.h - last.l;
    const lowerWick = Math.min(last.o, last.c) - last.l;
    const upperWick = last.h - Math.max(last.o, last.c);
    candle = 0;
    if (last.c > last.o && prev.c < prev.o && last.c >= prev.o && last.o <= prev.c) {
      candle = 1;
      candleTag = "bull_engulf";
    } else if (last.c < last.o && prev.c > prev.o && last.c <= prev.o && last.o >= prev.c) {
      candle = -1;
      candleTag = "bear_engulf";
    } else if (range > 0 && lowerWick > 2 * body && lowerWick > upperWick) {
      candle = 0.5;
      candleTag = "lower_wick";
    } else if (range > 0 && upperWick > 2 * body && upperWick > lowerWick) {
      candle = -0.5;
      candleTag = "upper_wick";
    }
  }
  // STRUCTURE: ICT OTE is the 62%–79% retrace of the last 30-bar leg. 70.5% is inside that band. A gap counts only on a return into it.
  let structure: number | null = null;
  let structTag = "none";
  if (bars.length >= 20 && last) {
    const w = bars.slice(-30);
    let hiI = 0;
    let loI = 0;
    w.forEach((b, i) => {
      if (b.h > w[hiI].h) hiI = i;
      if (b.l < w[loI].l) loI = i;
    });
    const hi = w[hiI].h;
    const lo = w[loI].l;
    const leg = hi - lo;
    structure = 0;
    if (leg > 0) {
      if (loI < hiI) {
        const r618 = hi - 0.618 * leg;
        const r79 = hi - 0.79 * leg;
        if (last.c <= r618 && last.c >= r79) {
          structure += 0.5;
          structTag = "ote_long";
        }
      } else if (hiI < loI) {
        const r618 = lo + 0.618 * leg;
        const r79 = lo + 0.79 * leg;
        if (last.c >= r618 && last.c <= r79) {
          structure -= 0.5;
          structTag = "ote_short";
        }
      }
    }
    // A fair value gap counts only when price has come back inside it. Being above a bull gap is a chase, not an entry.
    for (let i = w.length - 1; i >= 2; i -= 1) {
      const a = w[i - 2];
      const c = w[i];
      if (c.l > a.h) {
        const filled = w.slice(i + 1).some((b) => b.l <= a.h);
        const inside = last.c >= a.h && last.c <= c.l;
        if (!filled && inside) {
          structure += 0.25;
          structTag += "+bull_fvg";
        }
        break;
      }
      if (c.h < a.l) {
        const filled = w.slice(i + 1).some((b) => b.h >= a.l);
        const inside = last.c <= a.l && last.c >= c.h;
        if (!filled && inside) {
          structure -= 0.25;
          structTag += "+bear_fvg";
        }
        break;
      }
    }
    // Liquidity sweep: the bar runs the last 10 bars' high or low, then closes back inside. That is the stop hunt.
    const look = w.slice(-11, -1);
    if (look.length >= 5) {
      const swingLow = Math.min(...look.map((b) => b.l));
      const swingHigh = Math.max(...look.map((b) => b.h));
      const sweptLow = last.l < swingLow && last.c > swingLow;
      const sweptHigh = last.h > swingHigh && last.c < swingHigh;
      if (sweptLow && !sweptHigh) {
        structure += 0.5;
        structTag = structTag === "none" ? "sweep_low" : `${structTag}+sweep_low`;
      } else if (sweptHigh && !sweptLow) {
        structure -= 0.5;
        structTag = structTag === "none" ? "sweep_high" : `${structTag}+sweep_high`;
      }
    }
    // Supply and demand: last opposite candle before a push. Price back inside that candle is the zone.
    for (let i = w.length - 4; i >= 1; i -= 1) {
      const base = w[i];
      const impulse = w[i + 1];
      const later = w.slice(i + 2);
      if (base.c < base.o && impulse.c > base.h && impulse.c > impulse.o) {
        const broken = later.some((b) => b.c < base.l);
        const inside = last.c <= base.h && last.c >= base.l;
        if (!broken && inside) {
          structure += 0.5;
          structTag = structTag === "none" ? "demand" : `${structTag}+demand`;
        }
        break;
      }
      if (base.c > base.o && impulse.c < base.l && impulse.c < impulse.o) {
        const broken = later.some((b) => b.c > base.h);
        const inside = last.c >= base.l && last.c <= base.h;
        if (!broken && inside) {
          structure -= 0.5;
          structTag = structTag === "none" ? "supply" : `${structTag}+supply`;
        }
        break;
      }
    }
    structure = clamp1(structure);
  }
  const groups = { trend, momentum, structure, candle };
  const vals = Object.values(groups).filter((v): v is number => v != null);
  const score = vals.length ? clamp1(vals.reduce((a, b) => a + b, 0) / 4) : 0; // divide by 4: missing groups count as 0
  return {
    bars: bars.length,
    ema7: e7,
    ema14: e14,
    ema20: e20,
    ema50: e50,
    rsi14: r,
    ret5mBps: ret5,
    candle: candleTag,
    structure: structTag,
    groups,
    flow: null,
    score,
  };
}

/** Live logit step. At a 50¢ base a full score moves the chance by 4 points and no more.
 *  +0.45 and +0.80 are not used. Those steps are about 11 and 19 points, and this book has not scored them. */
export const LIVE_LOGIT = 0.16;

export function logit(p: number): number {
  const x = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return Math.log(x / (1 - x));
}

export function fromLogit(L: number): number {
  if (!Number.isFinite(L)) return 0.5;
  return 1 / (1 + Math.exp(-L));
}

/** Feature shift in probability points, ≤ FEATURE_MAX_SHIFT. Log-odds, then clamped. */
export function featureShift(pBase: number, score: number) {
  if (!Number.isFinite(pBase) || !Number.isFinite(score) || pBase <= 0 || pBase >= 1) return 0;
  const s = Math.max(-1, Math.min(1, score));
  if (s === 0) return 0;
  const shifted = fromLogit(logit(pBase) + LIVE_LOGIT * s) - pBase;
  return Math.max(-FEATURE_MAX_SHIFT, Math.min(FEATURE_MAX_SHIFT, shifted));
}

/** RVOL, CVD, VWAP, signed imbalance, and the top of book. A missing tape is null, not zero. */
export function flowFromBars(
  bars: Candle[] | null,
  source: string | null,
  fresh: boolean,
  ofi: number | null,
  book: FlowVote["book"] = null,
): FlowVote {
  if (!bars?.length) return { rvol: null, cvd: null, vwap: null, ofi, book, source, stale: true, why: "no bars" };
  const vol = rvol(bars);
  const tail = bars.slice(-8);
  const delta = cvd(tail);
  const session = vwap(bars.slice(-20));
  const signedN = tail.filter((b) => typeof b.delta === "number" && Number.isFinite(b.delta)).length;
  const gaps: string[] = [];
  if (vol == null) gaps.push("no traded volume");
  if (delta == null) gaps.push(signedN ? `signed ${signedN}/8` : "no signed trades");
  if (book == null) gaps.push("no book");
  if (!fresh) gaps.push("stale");
  return { rvol: vol, cvd: delta, vwap: session, ofi, book, source, stale: !fresh || vol == null, why: gaps.length ? gaps.join(", ") : null };
}

/** No venue prints a tape for this market. Nulls, not zeros. */
export function unavailableFlow(): FlowVote {
  return { rvol: null, cvd: null, vwap: null, ofi: null, book: null, source: null, stale: true, why: "unavailable: no venue tape" };
}

/** The side the 1-minute structure allows. Null means sit. A settlement chance cannot enter against this. */
export function technicalSide(f: FeatureSnapshot, spot: number, strike: number): { side: "yes" | "no" | null; why: string } {
  // Live book, 17–21 Oct: 16 entries with this candle, 2 wins, about −$32. A wick is not a setup.
  if (f.candle === "upper_wick") return { side: null, why: "upper wick is not an entry" };
  const rsi = f.rsi14;
  const ema20 = f.ema20;
  const bull = f.candle === "bull_engulf" || f.candle === "lower_wick";
  const bear = f.candle === "bear_engulf";
  const above = spot > strike;
  const below = spot < strike;
  if (f.structure.includes("sweep_low") && !f.structure.includes("sweep_high")) return { side: "yes", why: "liquidity sweep of the lows" };
  if (f.structure.includes("sweep_high") && !f.structure.includes("sweep_low")) return { side: "no", why: "liquidity sweep of the highs" };
  if (f.structure.includes("ote_long")) {
    if (bull || f.structure.includes("bull_fvg")) return { side: "yes", why: "fib pocket long" };
    return { side: null, why: "fib pocket needs a reaction" };
  }
  if (f.structure.includes("ote_short")) {
    if (bear || f.structure.includes("bear_fvg")) return { side: "no", why: "fib pocket short" };
    return { side: null, why: "fib pocket needs a reaction" };
  }
  if (f.structure.includes("bull_fvg") && above) return { side: "yes", why: "price back inside bull gap" };
  if (f.structure.includes("bear_fvg") && below) return { side: "no", why: "price back inside bear gap" };
  if (f.structure.includes("demand") && !f.structure.includes("supply")) return { side: "yes", why: "demand zone" };
  if (f.structure.includes("supply") && !f.structure.includes("demand")) return { side: "no", why: "supply zone" };
  if (rsi == null && ema20 == null) return { side: null, why: "indicators unread" };
  return { side: null, why: "no structure" };
}

/** Forex day split in New York time. It labels the shot. It does not ban a market. */
export function sessionTag(nowMs: number): "london" | "newyork" | "asia" | "off" {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(nowMs)) % 24;
  if (hour >= 2 && hour < 5) return "london";
  if (hour >= 8 && hour < 11) return "newyork";
  if (hour >= 19 || hour < 2) return "asia";
  return "off";
}
