import type { Bar } from "./bars.ts";

export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  const ag = gain / period;
  const al = loss / period;
  if (al === 0) return 100;
  const rs = ag / al;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

export function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

export function bollinger(closes: number[], period = 20) {
  if (closes.length < period) return null;
  const w = closes.slice(-period);
  const mid = w.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(w.reduce((a, b) => a + (b - mid) ** 2, 0) / period);
  const upper = mid + 2 * sd;
  const lower = mid - 2 * sd;
  const last = closes[closes.length - 1];
  const width = mid ? (upper - lower) / mid : 0;
  const pos = upper === lower ? 0.5 : (last - lower) / (upper - lower);
  return { mid, upper, lower, width: Number(width.toFixed(4)), pos: Number(pos.toFixed(3)) };
}

export type FibZone = "0.236" | "0.382" | "0.5" | "0.618" | "none";

export function fibConfluence(closes: number[], last: number): { zone: FibZone; dist: number | null } {
  if (closes.length < 8) return { zone: "none", dist: null };
  const hi = Math.max(...closes);
  const lo = Math.min(...closes);
  const span = hi - lo;
  if (span <= 0) return { zone: "none", dist: null };
  const levels: [FibZone, number][] = [
    ["0.236", hi - span * 0.236],
    ["0.382", hi - span * 0.382],
    ["0.5", hi - span * 0.5],
    ["0.618", hi - span * 0.618],
  ];
  let best: FibZone = "none";
  let dist = Infinity;
  for (const [name, px] of levels) {
    const d = Math.abs(last - px) / span;
    if (d < dist) {
      dist = d;
      best = d <= 0.08 ? name : "none";
    }
  }
  return { zone: best, dist: Number(dist.toFixed(3)) };
}

export function volumeSurprise(bars: Bar[]): number | null {
  if (bars.length < 6) return null;
  const prev = bars.slice(-6, -1).map((b) => b.v);
  const med = [...prev].sort((a, b) => a - b)[Math.floor(prev.length / 2)];
  if (!med) return null;
  return Number((bars[bars.length - 1].v / med).toFixed(2));
}

export function emaStack(closes: number[]): "up" | "down" | "flat" | null {
  const fast = ema(closes, 7);
  const slow = ema(closes, 14);
  if (fast == null || slow == null || slow === 0) return null;
  const gap = (fast - slow) / slow;
  if (gap > 0.001) return "up";
  if (gap < -0.001) return "down";
  return "flat";
}

/** Last 30 finished minutes of the official index. Flat is not a side. */
export function halfHourTape(bars: { c: number; h: number; l: number; closed: boolean }[]): {
  bias: "up" | "down" | "flat" | null;
  push: boolean | null;
} {
  const closed = bars.filter((b) => b.closed && b.c > 0 && b.h >= b.l);
  if (closed.length < 30) return { bias: null, push: null };
  const now = closed[closed.length - 1];
  const then = closed[closed.length - 30];
  const bps = ((now.c - then.c) / then.c) * 10_000;
  const bias = bps >= 5 ? "up" : bps <= -5 ? "down" : "flat";
  const width = (b: { h: number; l: number; c: number }) => ((b.h - b.l) / b.c) * 10_000;
  const prior = closed.slice(-3, -1);
  const avg = prior.reduce((a, b) => a + width(b), 0) / prior.length;
  return { bias, push: width(now) >= avg && width(now) > 0 };
}

export type IndexBar = { o: number; h: number; l: number; c: number };
export type StructureFib = "none" | "236" | "382" | "500" | "618";

/** RSI, 20/50 EMA, the 0.618 zone, and the last finished candle. Built from the settlement index, not the ticket. */
export function indexStructure(bars: IndexBar[]): {
  rsi: number | null;
  ema20: number | null;
  ema50: number | null;
  fibZone: StructureFib;
  engulf: "up" | "down" | null;
  rejection: "up" | "down" | null;
} {
  const closed = bars.filter((b) => b.c > 0 && b.h >= b.l);
  const closes = closed.map((b) => b.c);
  const last = closes.at(-1) ?? 0;
  const fib = fibConfluence(closes, last);
  const fibZone: StructureFib =
    fib.zone === "0.618" ? "618" : fib.zone === "0.5" ? "500" : fib.zone === "0.382" ? "382" : fib.zone === "0.236" ? "236" : "none";
  const prev = closed.at(-2);
  const bar = closed.at(-1);
  let engulf: "up" | "down" | null = null;
  let rejection: "up" | "down" | null = null;
  if (bar && prev) {
    const body = Math.abs(bar.c - bar.o);
    const prevBody = Math.abs(prev.c - prev.o);
    const range = bar.h - bar.l;
    const upper = bar.h - Math.max(bar.o, bar.c);
    const lower = Math.min(bar.o, bar.c) - bar.l;
    if (range > 0 && lower > body * 2 && body / range < 0.35) rejection = "up";
    else if (range > 0 && upper > body * 2 && body / range < 0.35) rejection = "down";
    if (bar.c > bar.o && prev.c < prev.o && body > prevBody && bar.c >= prev.o && bar.o <= prev.c) engulf = "up";
    if (bar.c < bar.o && prev.c > prev.o && body > prevBody && bar.o >= prev.c && bar.c <= prev.o) engulf = "down";
  }
  return { rsi: rsi(closes, 14), ema20: ema(closes, 20), ema50: ema(closes, 50), fibZone, engulf, rejection };
}
