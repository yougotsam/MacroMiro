import type { Bar, BookId, FibZone, Regime, Tape } from "./types";

export type TapeSettings = {
  emaFast: number;
  emaSlow: number;
  rsiPeriod: number;
};

export const DEFAULT_TAPE: TapeSettings = { emaFast: 7, emaSlow: 14, rsiPeriod: 14 };

export function clampPeriod(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function ema(values: number[], period: number): number {
  const k = 2 / (period + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

export function readTape(
  book: BookId,
  symbol: string,
  venue: string,
  bars: Bar[],
  last: number,
  changePct: number | null,
  asOf: string,
  settings: TapeSettings = DEFAULT_TAPE,
): Tape {
  const usable = bars.filter((b) => Number.isFinite(b.c) && Number.isFinite(b.h) && Number.isFinite(b.l));
  const closes = usable.map((b) => b.c);
  const px = last || closes[closes.length - 1] || 0;
  const fast = clampPeriod(settings.emaFast, 2, 48);
  const slow = clampPeriod(settings.emaSlow, 3, 96);
  const rsiP = clampPeriod(settings.rsiPeriod, 2, 48);
  if (closes.length < 5) {
    return {
      book,
      symbol,
      venue,
      last: px,
      changePct,
      bars: usable,
      ema9: px,
      ema21: px,
      vwap: px,
      fib236: px,
      fib382: px,
      fib50: px,
      fib618: px,
      fib786: px,
      fibZone: "none",
      stretchPct: 0,
      stacked: "chop",
      atFib: false,
      rsi: null,
      atr: 0,
      adx: null,
      plusDi: null,
      minusDi: null,
      regime: "mixed",
      volRatio: 1,
      bbMid: px,
      bbUpper: px,
      bbLower: px,
      asOf,
    };
  }
  const emaFast = ema(closes, Math.min(fast, closes.length));
  const emaSlow = ema(closes, Math.min(slow, closes.length));
  let pv = 0;
  let vv = 0;
  for (const b of usable) {
    const tp = (b.h + b.l + b.c) / 3;
    pv += tp * (b.v || 1);
    vv += b.v || 1;
  }
  const vwap = pv / vv;
  const swingHigh = Math.max(...usable.map((b) => b.h));
  const swingLow = Math.min(...usable.map((b) => b.l));
  const range = swingHigh - swingLow || 1;
  const fib236 = swingHigh - range * 0.236;
  const fib382 = swingHigh - range * 0.382;
  const fib50 = swingHigh - range * 0.5;
  const fib618 = swingHigh - range * 0.618;
  const fib786 = swingHigh - range * 0.786;
  const stretchPct = vwap ? ((px - vwap) / vwap) * 100 : 0;
  const stacked = emaFast > emaSlow && px > vwap ? "long" : emaFast < emaSlow && px < vwap ? "short" : "chop";
  let fibZone: FibZone = "none";
  if (px <= fib382 && px >= fib618) fibZone = "load";
  else if (px < fib618 && px >= fib786) fibZone = "deep";
  else if (px < fib786) fibZone = "break";
  const atFib = fibZone === "load" || fibZone === "deep";
  const rsi = rsiN(closes, rsiP);
  const atr = atr14(usable);
  const di = adx14(usable);
  const adx = di?.adx ?? null;
  const regime: Regime = adx == null ? "mixed" : adx >= 25 ? "trend" : adx < 20 ? "range" : "mixed";
  const volSlice = usable.slice(-21);
  const lastVol = volSlice[volSlice.length - 1]?.v ?? 0;
  const avgVol =
    volSlice.length > 1
      ? volSlice.slice(0, -1).reduce((a, b) => a + (b.v || 0), 0) / Math.max(1, volSlice.length - 1)
      : lastVol;
  const volRatio = avgVol > 0 ? lastVol / avgVol : 1;
  const bb = boll(closes, 20);
  return {
    book,
    symbol,
    venue,
    last: px,
    changePct,
    bars: usable.slice(-80),
    ema9: emaFast,
    ema21: emaSlow,
    vwap,
    fib236,
    fib382,
    fib50,
    fib618,
    fib786,
    fibZone,
    stretchPct,
    stacked,
    atFib,
    rsi,
    atr,
    adx,
    plusDi: di?.plusDi ?? null,
    minusDi: di?.minusDi ?? null,
    regime,
    volRatio,
    bbMid: bb.mid,
    bbUpper: bb.upper,
    bbLower: bb.lower,
    asOf,
  };
}

function rsiN(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;
  let up = 0;
  let down = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) up += d;
    else down -= d;
  }
  const avgU = up / period;
  const avgD = down / period;
  if (avgD === 0) return 100;
  const rs = avgU / avgD;
  return 100 - 100 / (1 + rs);
}

function atr14(bars: { h: number; l: number; c: number }[]): number {
  if (bars.length < 2) return 0;
  const slice = bars.slice(-15);
  let sum = 0;
  for (let i = 1; i < slice.length; i++) {
    const tr = Math.max(
      slice[i].h - slice[i].l,
      Math.abs(slice[i].h - slice[i - 1].c),
      Math.abs(slice[i].l - slice[i - 1].c),
    );
    sum += tr;
  }
  return sum / Math.max(1, slice.length - 1);
}

function adx14(bars: { h: number; l: number; c: number }[]) {
  if (bars.length < 16) return null;
  const plus: number[] = [];
  const minus: number[] = [];
  const tr: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const up = bars[i].h - bars[i - 1].h;
    const dn = bars[i - 1].l - bars[i].l;
    plus.push(up > dn && up > 0 ? up : 0);
    minus.push(dn > up && dn > 0 ? dn : 0);
    tr.push(
      Math.max(
        bars[i].h - bars[i].l,
        Math.abs(bars[i].h - bars[i - 1].c),
        Math.abs(bars[i].l - bars[i - 1].c),
      ),
    );
  }
  const n = tr.length >= 28 ? 14 : 8;
  if (tr.length < n + 2) return null;
  let atr = tr.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let pdm = plus.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let mdm = minus.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const dx: number[] = [];
  let plusDi = 0;
  let minusDi = 0;
  for (let i = n; i < tr.length; i++) {
    atr = (atr * (n - 1) + tr[i]) / n;
    pdm = (pdm * (n - 1) + plus[i]) / n;
    mdm = (mdm * (n - 1) + minus[i]) / n;
    plusDi = atr ? (100 * pdm) / atr : 0;
    minusDi = atr ? (100 * mdm) / atr : 0;
    const den = plusDi + minusDi;
    dx.push(den ? (100 * Math.abs(plusDi - minusDi)) / den : 0);
  }
  if (dx.length < n) return { adx: dx.reduce((a, b) => a + b, 0) / dx.length, plusDi, minusDi };
  const adx = dx.slice(-n).reduce((a, b) => a + b, 0) / n;
  return { adx, plusDi, minusDi };
}

function boll(closes: number[], n: number) {
  const slice = closes.slice(-n);
  const mid = slice.reduce((a, b) => a + b, 0) / slice.length;
  const v = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / slice.length;
  const sd = Math.sqrt(v);
  return { mid, upper: mid + 2 * sd, lower: mid - 2 * sd };
}

function realizedVol(closes: number[]): number {
  if (closes.length < 8) return 0.5;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (rets.length < 4) return 0.5;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.max(0.15, Math.min(1.6, Math.sqrt(v) * Math.sqrt(365 * 24 * 4)));
}

function erf(x: number) {
  const s = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return s * y;
}

export function normCdf(x: number) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function fairAbove(spot: number, strike: number, years: number, sigma: number) {
  if (spot <= 0 || strike <= 0 || years <= 0 || sigma <= 0) return null;
  const d = Math.log(spot / strike) / (sigma * Math.sqrt(years));
  return normCdf(d);
}

export function volFromBars(bars: { c: number }[]) {
  return realizedVol(bars.map((b) => b.c));
}

export function candlePath(
  bars: Bar[],
  w = 560,
  h = 160,
  settings: TapeSettings = DEFAULT_TAPE,
  marks: { label: string; price: number }[] = [],
) {
  const clean = bars.filter((b) => b.o > 0 && b.h > 0 && b.l > 0 && b.c > 0 && b.l <= b.h && b.h < 1e9);
  const slice = (clean.length >= 4 ? clean : bars.filter((b) => b.c > 0)).slice(-120);
  const empty = {
    wicks: [] as string[],
    bodies: [] as { x: number; y: number; w: number; h: number; up: boolean }[],
    emaFast: "",
    emaSlow: "",
    rsi: "",
    rsi30: 0,
    rsi70: 0,
    ticks: [] as { y: number; label: string }[],
    guides: [] as { y: number; label: string }[],
    lastY: 0,
  };
  if (!slice.length) return empty;
  const max = Math.max(...slice.map((b) => b.h));
  const min = Math.min(...slice.map((b) => b.l));
  const span = max - min || Math.max(Math.abs(max) * 0.002, 0.01);
  const pad = span * 0.08;
  const ticket = max < 1.5;
  const lo = ticket ? Math.max(0, min - pad) : min - pad;
  const hi = ticket ? Math.min(1, max + pad) : max + pad;
  const gutter = 58;
  const plotW = w - gutter;
  const gap = plotW / slice.length;
  const y = (v: number) => 10 + (1 - (v - lo) / (hi - lo || 1)) * (h - 20);
  const wicks: string[] = [];
  const bodies: { x: number; y: number; w: number; h: number; up: boolean }[] = [];
  slice.forEach((b, i) => {
    const x = i * gap + gap / 2;
    wicks.push(`M${x.toFixed(1)} ${y(b.h).toFixed(1)} L${x.toFixed(1)} ${y(b.l).toFixed(1)}`);
    const top = Math.max(b.o, b.c);
    const bot = Math.min(b.o, b.c);
    const bh = Math.max(1, y(bot) - y(top));
    bodies.push({
      x: x - Math.max(1.2, gap * 0.32),
      y: y(top),
      w: Math.max(1.2, gap * 0.45),
      h: bh,
      up: b.c >= b.o,
    });
  });
  const decimals = hi < 5 ? 2 : hi < 100 ? 1 : 0;
  const ticks = [hi, (hi + lo) / 2, lo].map((v) => ({
    y: y(v),
    label: ticket ? `${Math.round(v * 100)}¢` : v.toFixed(decimals),
  }));
  const last = slice[slice.length - 1].c;
  const closes = slice.map((b) => b.c);
  const fast = emaSeries(closes, clampPeriod(settings.emaFast, 2, 48));
  const slow = emaSeries(closes, clampPeriod(settings.emaSlow, 3, 96));
  const rsiVals = rsiSeries(closes, clampPeriod(settings.rsiPeriod, 2, 48));
  const emaFast = linePath(fast.map((v, i) => ({ x: i * gap + gap / 2, y: y(v) })));
  const emaSlow = linePath(slow.map((v, i) => ({ x: i * gap + gap / 2, y: y(v) })));
  const rsiH = 56;
  const rsiY = (v: number) => rsiH - 4 - (v / 100) * (rsiH - 8);
  const rsi = linePath(
    rsiVals.map((v, i) => ({ x: i * gap + gap / 2, y: v == null ? null : rsiY(v) })),
  );
  const guides = marks
    .filter((m) => m.price >= lo && m.price <= hi)
    .map((m) => ({ y: y(m.price), label: m.label }));
  return { wicks, bodies, emaFast, emaSlow, rsi, rsi30: rsiY(30), rsi70: rsiY(70), ticks, guides, lastY: y(last) };
}

function emaSeries(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  let e = values[0];
  return values.map((v, i) => {
    e = i === 0 ? v : v * k + e * (1 - k);
    return e;
  });
}

function rsiSeries(closes: number[], period: number): (number | null)[] {
  return closes.map((_, i) => {
    if (i < period) return null;
    let up = 0;
    let down = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - closes[j - 1];
      if (d >= 0) up += d;
      else down -= d;
    }
    const avgD = down / period;
    if (avgD === 0) return 100;
    return 100 - 100 / (1 + up / period / avgD);
  });
}

function linePath(pts: { x: number; y: number | null }[]) {
  let d = "";
  let start = false;
  for (const p of pts) {
    if (p.y == null || !Number.isFinite(p.y)) {
      start = false;
      continue;
    }
    d += start ? `L${p.x.toFixed(1)} ${p.y.toFixed(1)} ` : `M${p.x.toFixed(1)} ${p.y.toFixed(1)} `;
    start = true;
  }
  return d.trim();
}
