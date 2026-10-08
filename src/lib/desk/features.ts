/**
 * Supporting features on the settlement index's own 1-minute bars (built from 1-second prints).
 * Four evidence groups, one vote each (no double counting). Combined shift ≤ ±FEATURE_MAX_SHIFT,
 * scaled by 4·P·(1−P) so features can't move near-certain contracts. Features never pick a side alone.
 */
import { FEATURE_MAX_SHIFT } from "./config";
import type { Print } from "./settlement";

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
  ema50: number | null;
  rsi14: number | null;
  ret5mBps: number | null;
  candle: string;
  structure: string;
  groups: { trend: number | null; momentum: number | null; structure: number | null; candle: number | null };
  score: number; // mean of available groups, [-1, 1], + = YES-leaning
};

export function features(bars: Bar[]): FeatureSnapshot {
  const closes = bars.map((b) => b.c);
  const e7 = ema(closes, 7);
  const e14 = ema(closes, 14);
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
  // MOMENTUM: RSI 14 regime + 5-minute return sign
  let momentum: number | null = null;
  if (r != null) {
    const rs = r > 70 ? 0.25 : r < 30 ? -0.25 : clamp1((r - 50) / 20); // extremes = stretched, half credit
    const rt = ret5 == null ? 0 : clamp1(ret5 / 10);
    momentum = clamp1(0.5 * rs + 0.5 * rt);
  }
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
  // STRUCTURE: fib OTE (0.618–0.705) of the last 30-bar leg + FVG + order-block touch (deterministic)
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
        const r705 = hi - 0.705 * leg;
        if (last.c <= r618 && last.c >= r705) {
          structure += 0.5;
          structTag = "ote_long";
        }
      } else if (hiI < loI) {
        const r618 = lo + 0.618 * leg;
        const r705 = lo + 0.705 * leg;
        if (last.c >= r618 && last.c <= r705) {
          structure -= 0.5;
          structTag = "ote_short";
        }
      }
    }
    // most recent unfilled 3-bar fair value gap
    for (let i = w.length - 1; i >= 2; i -= 1) {
      const a = w[i - 2];
      const c = w[i];
      if (c.l > a.h) {
        const filled = w.slice(i + 1).some((b) => b.l <= a.h);
        if (!filled && last.c > a.h) {
          structure += 0.25;
          structTag += "+bull_fvg";
        }
        break;
      }
      if (c.h < a.l) {
        const filled = w.slice(i + 1).some((b) => b.h >= a.l);
        if (!filled && last.c < a.l) {
          structure -= 0.25;
          structTag += "+bear_fvg";
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
    ema50: e50,
    rsi14: r,
    ret5mBps: ret5,
    candle: candleTag,
    structure: structTag,
    groups,
    score,
  };
}

/** Feature shift in probability points, ≤ FEATURE_MAX_SHIFT, shrinking toward the extremes. */
export function featureShift(pBase: number, score: number) {
  return FEATURE_MAX_SHIFT * Math.max(-1, Math.min(1, score)) * 4 * pBase * (1 - pBase);
}
