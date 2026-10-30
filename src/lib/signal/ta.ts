/**
 * Price tools the pre-trade checklist reads. Pure, closed bars only, no look-ahead:
 * every function looks at bars[0..i] and never past i.
 * Sources: the AEIOU/MMM prompt set (EMA 9/21/50 stack, 13/50/200/800 tunnel, RSI divergence,
 * ATR, ADR exhaustion, session VWAP) and standard definitions (Wilder RSI/ATR).
 */
export type Bar = { t: number; o: number; h: number; l: number; c: number; v?: number };

/** EMA series, seeded with the SMA of the first n values. Index i is null until i = n-1. */
export function emaSeries(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < n) return out;
  const k = 2 / (n + 1);
  let e = 0;
  for (let i = 0; i < n; i++) e += values[i];
  e /= n;
  out[n - 1] = e;
  for (let i = n; i < values.length; i++) {
    e = values[i] * k + e * (1 - k);
    out[i] = e;
  }
  return out;
}

/** Wilder RSI series. */
export function rsiSeries(values: number[], n = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length < n + 1) return out;
  let g = 0;
  let l = 0;
  for (let i = 1; i <= n; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) g += d;
    else l -= d;
  }
  g /= n;
  l /= n;
  const val = () => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
  out[n] = val();
  for (let i = n + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    g = (g * (n - 1) + Math.max(0, d)) / n;
    l = (l * (n - 1) + Math.max(0, -d)) / n;
    out[i] = val();
  }
  return out;
}

/** Wilder ATR series. */
export function atrSeries(bars: Bar[], n = 14): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  if (bars.length < n + 1) return out;
  const tr = (i: number) => Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
  let a = 0;
  for (let i = 1; i <= n; i++) a += tr(i);
  a /= n;
  out[n] = a;
  for (let i = n + 1; i < bars.length; i++) {
    a = (a * (n - 1) + tr(i)) / n;
    out[i] = a;
  }
  return out;
}

const UTC_DAY = 86_400_000;

/** VWAP since 00:00 UTC of each bar's day (typical price × volume). Bars without volume weigh 1. */
export function sessionVwapSeries(bars: Bar[]): number[] {
  const out: number[] = [];
  let day = -1;
  let pv = 0;
  let vv = 0;
  for (const b of bars) {
    const d = Math.floor(b.t / UTC_DAY);
    if (d !== day) {
      day = d;
      pv = 0;
      vv = 0;
    }
    const v = b.v && b.v > 0 ? b.v : 1;
    pv += ((b.h + b.l + b.c) / 3) * v;
    vv += v;
    out.push(pv / vv);
  }
  return out;
}

/**
 * ADR exhaustion (MMM #109): how much of the average daily range (last `days` full UTC days)
 * today has already used, at each bar. Null until enough days exist.
 */
export function adrUsedSeries(bars: Bar[], days = 14): { used: (number | null)[]; dayMove: number[] } {
  const used: (number | null)[] = [];
  const dayMove: number[] = [];
  const ranges: number[] = [];
  let day = -1;
  let hi = -Infinity;
  let lo = Infinity;
  let open = 0;
  for (const b of bars) {
    const d = Math.floor(b.t / UTC_DAY);
    if (d !== day) {
      if (day !== -1 && Number.isFinite(hi)) ranges.push(hi - lo);
      day = d;
      hi = -Infinity;
      lo = Infinity;
      open = b.o;
    }
    hi = Math.max(hi, b.h);
    lo = Math.min(lo, b.l);
    const recent = ranges.slice(-days);
    const adr = recent.length >= days ? recent.reduce((a, x) => a + x, 0) / recent.length : null;
    used.push(adr && adr > 0 ? (hi - lo) / adr : null);
    dayMove.push(b.c - open);
  }
  return { used, dayMove };
}

/**
 * Regular RSI divergence at bar i over the last `look` bars: price makes a lower low while RSI makes a higher
 * low (bullish, +1), or a higher high with a lower RSI high (bearish, −1). Compares the last `seg` bars with the
 * `look - seg` bars before them.
 */
export function rsiDivergence(bars: Bar[], rsi: (number | null)[], i: number, look = 30, seg = 6): -1 | 0 | 1 {
  if (i < look) return 0;
  let pLoA = Infinity, rLoA = Infinity, pHiA = -Infinity, rHiA = -Infinity;
  let pLoB = Infinity, rLoB = Infinity, pHiB = -Infinity, rHiB = -Infinity;
  for (let j = i - look + 1; j <= i; j++) {
    const r = rsi[j];
    if (r == null) return 0;
    if (j <= i - seg) {
      if (bars[j].l < pLoA) { pLoA = bars[j].l; rLoA = r; }
      if (bars[j].h > pHiA) { pHiA = bars[j].h; rHiA = r; }
    } else {
      if (bars[j].l < pLoB) { pLoB = bars[j].l; rLoB = r; }
      if (bars[j].h > pHiB) { pHiB = bars[j].h; rHiB = r; }
    }
  }
  const bull = pLoB < pLoA && rLoB > rLoA + 2;
  const bear = pHiB > pHiA && rHiB < rHiA - 2;
  if (bull && !bear) return 1;
  if (bear && !bull) return -1;
  return 0;
}
