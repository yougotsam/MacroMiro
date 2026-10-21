/**
 * Two extra ways in. Neither one sets the chance and neither one can cancel a call.
 * They only agree with a side the settlement model already priced, when the 1-minute
 * list and the sniper were both quiet.
 *
 * FIB_RETRACE: last 30 closed minutes. The swing is up if the low printed before the high.
 * Enter only while the close is between the 38.2% and 61.8% retracement, with a candle
 * back in the direction of the swing. The deep 62–79% pocket stays with the existing fib tag.
 *
 * EMA_PULLBACK: 20-minute average above the 50 for a long (mirror for a short), a touch of
 * the 20 in the last five closes, and a close back on the trend side of it. Sitting above
 * the average is not this strategy.
 */
import { ema, type Bar } from "./features";

export type StrategyName = "FIB_RETRACE" | "EMA_PULLBACK";
export type StrategyCall = { name: StrategyName; side: "yes" | "no"; why: string };

function swing(bars: Bar[]) {
  const w = bars.slice(-30);
  if (w.length < 20) return null;
  let hiI = 0;
  let loI = 0;
  w.forEach((b, i) => {
    if (b.h > w[hiI].h) hiI = i;
    if (b.l < w[loI].l) loI = i;
  });
  const hi = w[hiI].h;
  const lo = w[loI].l;
  const leg = hi - lo;
  if (!(leg > 0) || hiI === loI) return null;
  const ranges = w.map((b) => b.h - b.l).filter((x) => x > 0).sort((a, b) => a - b);
  const med = ranges.length ? ranges[Math.floor(ranges.length / 2)] : 0;
  if (!(med > 0) || leg < 3 * med) return null;
  return { hi, lo, hiI, loI, leg, last: w[w.length - 1] };
}

function wick(b: Bar) {
  const range = b.h - b.l;
  const body = Math.abs(b.c - b.o);
  const upper = b.h - Math.max(b.o, b.c);
  const lower = Math.min(b.o, b.c) - b.l;
  return {
    upper: range > 0 && upper > 2 * body && upper > lower,
    lower: range > 0 && lower > 2 * body && lower > upper,
  };
}

/** Classic Fibonacci retracement of the last 30-minute swing. 38.2% to 61.8% only. */
export function fibRetrace(bars: Bar[]): StrategyCall | null {
  const s = swing(bars);
  if (!s) return null;
  const up = s.loI < s.hiI;
  const depth = up ? (s.hi - s.last.c) / s.leg : (s.last.c - s.lo) / s.leg;
  if (!(depth >= 0.382 && depth <= 0.618)) return null;
  if (up && s.last.c <= s.lo) return null;
  if (!up && s.last.c >= s.hi) return null;
  const w = wick(s.last);
  if (up) {
    if (!(s.last.c > s.last.o) || w.upper) return null;
    return { name: "FIB_RETRACE", side: "yes", why: "fib retrace 38-62 long" };
  }
  if (!(s.last.c < s.last.o) || w.lower) return null;
  return { name: "FIB_RETRACE", side: "no", why: "fib retrace 38-62 short" };
}

/** Trend from the 20/50 averages. Entry is the pullback to the 20, not the cross. */
export function emaPullback(bars: Bar[]): StrategyCall | null {
  if (bars.length < 50) return null;
  const e20 = ema(bars.map((b) => b.c), 20);
  const e50 = ema(bars.map((b) => b.c), 50);
  if (e20 == null || e50 == null) return null;
  const last = bars[bars.length - 1];
  const recent = bars.slice(-5);
  const w = wick(last);
  if (e20 > e50 && last.c > e20 && recent.some((b) => b.l <= e20) && last.c > last.o && !w.upper)
    return { name: "EMA_PULLBACK", side: "yes", why: "ema20 pullback long" };
  if (e20 < e50 && last.c < e20 && recent.some((b) => b.h >= e20) && last.c < last.o && !w.lower)
    return { name: "EMA_PULLBACK", side: "no", why: "ema20 pullback short" };
  return null;
}

/** Fibonacci first. The average pullback only if the retracement did not fire. */
export function strategyCall(bars: Bar[]): StrategyCall | null {
  return fibRetrace(bars) ?? emaPullback(bars);
}
