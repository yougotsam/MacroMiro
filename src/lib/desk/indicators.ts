/**
 * Sniper setup detection on REAL exchange bars (Coinbase public candles/trades). Research evidence only: nothing here
 * produces a settlement probability or authorizes a trade (the 13-point confluence score in sniper.ts ranks candidates;
 * approval.ts decides on calibrated P + conservative EV). Every module reports AVAILABLE or UNAVAILABLE with a reason —
 * missing inputs (no volume, no signed trades, too few bars) are never filled with proxies.
 */
import { atr, bollinger, confirmedSwings, cvd, emaSeries, fibPocket, fvg, macd, orderBlockCandidate, rsiSeries, rvol, stochRsi, vwap, type Candle, type Direction } from "./sniper";
import type { PublicTrade } from "./market-data";

export type Module<T> = { available: true; value: T } | { available: false; reason: string };
const ok = <T>(value: T): Module<T> => ({ available: true, value });
const no = <T>(reason: string): Module<T> => ({ available: false, reason });
const hasVolume = (b: Candle[]) => b.length > 0 && b.every((x) => x.v != null && Number.isFinite(x.v) && x.v >= 0);

/**
 * Market structure on confirmed pivots. Trend = last two swing highs AND lows both higher (up) or both lower (down).
 * BOS: close beyond the last swing in the trend direction. MSS: first close beyond the last swing AGAINST the prior trend.
 */
export function marketStructure(b: Candle[], wing = 3): { trend: "up" | "down" | "range"; bos: Direction | null; mss: Direction | null } | null {
  if (b.length < wing * 2 + 5) return null;
  const { highs, lows } = confirmedSwings(b, wing);
  if (highs.length < 2 || lows.length < 2) return null;
  const [h1, h2] = highs.slice(-2);
  const [l1, l2] = lows.slice(-2);
  const trend = h2.price > h1.price && l2.price > l1.price ? "up" : h2.price < h1.price && l2.price < l1.price ? "down" : "range";
  const c = b.at(-1)!.c;
  const brokeUp = c > h2.price;
  const brokeDown = c < l2.price;
  return {
    trend,
    bos: trend === "up" && brokeUp ? "long" : trend === "down" && brokeDown ? "short" : null,
    mss: trend === "down" && brokeUp ? "long" : trend === "up" && brokeDown ? "short" : null,
  };
}

/** Liquidity sweep: the last bar trades through the last confirmed swing by ≥ k·ATR and closes back inside. */
export function liquiditySweep(b: Candle[], k = 0.1, wing = 3): Direction | null {
  const a = atr(b);
  if (a == null || !(a > 0)) return null;
  const { highs, lows } = confirmedSwings(b.slice(0, -1), wing);
  const last = b.at(-1)!;
  const lo = lows.at(-1);
  const hi = highs.at(-1);
  if (lo && last.l < lo.price - k * a && last.c > lo.price) return "long";
  if (hi && last.h > hi.price + k * a && last.c < hi.price) return "short";
  return null;
}

export type Pattern = "bullish_engulfing" | "bearish_engulfing" | "hammer" | "shooting_star" | "doji" | "inside_bar";
export function candlePatterns(b: Candle[]): Pattern[] {
  if (b.length < 2) return [];
  const p = b.at(-2)!;
  const x = b.at(-1)!;
  const out: Pattern[] = [];
  const body = Math.abs(x.c - x.o);
  const range = x.h - x.l;
  if (!(range > 0)) return out;
  const upper = x.h - Math.max(x.o, x.c);
  const lower = Math.min(x.o, x.c) - x.l;
  if (p.c < p.o && x.c > x.o && x.c >= p.o && x.o <= p.c) out.push("bullish_engulfing");
  if (p.c > p.o && x.c < x.o && x.c <= p.o && x.o >= p.c) out.push("bearish_engulfing");
  if (lower >= 2 * body && upper <= 0.25 * range && body > 0) out.push("hammer");
  if (upper >= 2 * body && lower <= 0.25 * range && body > 0) out.push("shooting_star");
  if (body <= 0.1 * range) out.push("doji");
  if (x.h < p.h && x.l > p.l) out.push("inside_bar");
  return out;
}

/** Volume profile from bar volume spread uniformly over each bar's range: POC and the 70% value area. */
export function volumeProfile(b: Candle[], bins = 24): { poc: number; vah: number; val: number } | null {
  if (!hasVolume(b) || b.length < 2) return null;
  const lo = Math.min(...b.map((x) => x.l));
  const hi = Math.max(...b.map((x) => x.h));
  if (!(hi > lo)) return null;
  const w = (hi - lo) / bins;
  const vol = new Array<number>(bins).fill(0);
  for (const x of b) {
    const a = Math.min(bins - 1, Math.floor((x.l - lo) / w));
    const z = Math.min(bins - 1, Math.floor((x.h - lo) / w));
    for (let i = a; i <= z; i += 1) vol[i] += x.v! / (z - a + 1);
  }
  const total = vol.reduce((s, v) => s + v, 0);
  if (!(total > 0)) return null;
  const poc = vol.indexOf(Math.max(...vol));
  let lo2 = poc;
  let hi2 = poc;
  let acc = vol[poc];
  while (acc < 0.7 * total && (lo2 > 0 || hi2 < bins - 1)) {
    const down = lo2 > 0 ? vol[lo2 - 1] : -1;
    const up = hi2 < bins - 1 ? vol[hi2 + 1] : -1;
    if (up >= down) acc += vol[++hi2];
    else acc += vol[--lo2];
  }
  const mid = (i: number) => lo + (i + 0.5) * w;
  return { poc: mid(poc), vah: lo + (hi2 + 1) * w, val: lo + lo2 * w };
}

export function fibLevels(swingLow: number, swingHigh: number) {
  if (!(swingHigh > swingLow)) return null;
  const r = swingHigh - swingLow;
  return Object.fromEntries([0.236, 0.382, 0.5, 0.618, 0.65, 0.786].map((f) => [String(f), swingHigh - f * r])) as Record<string, number>;
}

/** Per-minute signed delta from a contiguous public-trade tape (trade ids without gaps); gaps leave minutes unknown. */
export class TradeTape {
  private trades = new Map<number, PublicTrade>();
  add(batch: PublicTrade[]) {
    for (const t of batch) if (Number.isInteger(t.trade_id)) this.trades.set(t.trade_id, t);
  }
  prune(beforeMs: number) {
    for (const [id, t] of this.trades) if (Date.parse(t.time) < beforeMs) this.trades.delete(id);
  }
  /** Minutes fully inside one gap-free run of trade ids get a delta; everything else stays undefined. */
  deltaByMinute(): Map<number, number> {
    const ids = [...this.trades.keys()].sort((a, b) => a - b);
    const out = new Map<number, number>();
    let runStart = 0;
    for (let i = 1; i <= ids.length; i += 1) {
      if (i === ids.length || ids[i] !== ids[i - 1] + 1) {
        const run = ids.slice(runStart, i).map((id) => this.trades.get(id)!);
        const times = run.map((t) => Date.parse(t.time));
        const first = Math.floor(Math.min(...times) / 60_000) * 60_000 + 60_000; // first fully covered minute
        const last = Math.max(...times);
        for (const t of run) {
          const ts = Date.parse(t.time);
          const m = Math.floor(ts / 60_000) * 60_000;
          if (m < first || m + 60_000 > last) continue;
          const size = Number(t.size);
          const sign = t.side === "sell" ? 1 : t.side === "buy" ? -1 : 0; // Coinbase side = maker side
          if (!Number.isFinite(size) || !sign) continue;
          out.set(m, (out.get(m) ?? 0) + sign * size);
        }
        for (let m = first; m + 60_000 <= last; m += 60_000) if (!out.has(m)) out.set(m, 0);
        runStart = i;
      }
    }
    return out;
  }
  get size() {
    return this.trades.size;
  }
}

export type IndicatorReport = Record<string, Module<unknown>>;

/** Every listed indicator for one instrument, with availability (bars = 1-minute or 15-minute real exchange bars). */
export function indicatorReport(bars: Candle[], opts: { volumeSource: string | null; tradeSide: boolean }): IndicatorReport {
  const c = bars.map((x) => x.c);
  const a = atr(bars);
  const vol = opts.volumeSource && hasVolume(bars);
  const sw = confirmedSwings(bars);
  const lo = sw.lows.at(-1)?.price;
  const hi = sw.highs.at(-1)?.price;
  const need = (n: number, name: string) => (bars.length < n ? `${name} needs ${n} bars, have ${bars.length}` : null);
  const lastE = (n: number) => emaSeries(c, n).at(-1);
  const r: IndicatorReport = {};
  const ms = marketStructure(bars);
  r.bos_mss = ms ? ok(ms) : no(need(11, "structure") ?? "fewer than two confirmed swing highs/lows");
  r.liquidity_sweep = a == null ? no(need(15, "ATR") ?? "ATR unavailable") : ok(liquiditySweep(bars));
  r.fvg = a == null ? no("ATR unavailable") : ok(fvg(bars, a));
  r.order_block = a == null ? no("ATR unavailable") : ok({ long: orderBlockCandidate(bars, "long", a), short: orderBlockCandidate(bars, "short", a) });
  r.fibonacci = lo != null && hi != null && hi > lo ? ok({ levels: fibLevels(lo, hi), longPocket: fibPocket(c.at(-1)!, lo, hi, "long"), shortPocket: fibPocket(c.at(-1)!, lo, hi, "short") }) : no("no confirmed swing high above a swing low");
  for (const n of [7, 14, 50, 200]) {
    const e = lastE(n);
    r[`ema${n}`] = e == null ? no(`EMA${n} needs ${n} bars, have ${bars.length}`) : ok(e);
  }
  r.vwap = vol ? ok(vwap(bars)) : no(opts.volumeSource ? "bars missing volume" : "no traded-volume source for this market");
  const rs = rsiSeries(c).at(-1);
  r.rsi = rs == null ? no(need(15, "RSI") ?? "RSI unavailable") : ok(rs);
  const st = stochRsi(c);
  r.stoch_rsi = st ? ok(st) : no(need(32, "Stoch RSI") ?? "Stoch RSI unavailable");
  const m = macd(c);
  r.macd = m ? ok(m) : no(need(34, "MACD") ?? "MACD unavailable");
  r.atr = a == null ? no(need(15, "ATR") ?? "ATR unavailable") : ok(a);
  const bb = bollinger(c);
  r.bollinger = bb ? ok(bb) : no(need(20, "Bollinger") ?? "Bollinger unavailable");
  r.candle_patterns = bars.length >= 2 ? ok(candlePatterns(bars)) : no("needs 2 bars");
  const rv = vol ? rvol(bars) : null;
  r.rvol = !vol ? no(opts.volumeSource ? "bars missing volume" : "no traded-volume source for this market") : rv == null ? no(need(21, "RVOL") ?? "zero base volume") : ok(rv);
  const withDelta = bars.filter((x) => x.delta != null);
  r.cvd = !opts.tradeSide ? no("no signed (aggressor-side) trade feed for this market") : withDelta.length < 5 ? no(`signed-trade coverage ${withDelta.length} bars (<5 contiguous)`) : ok(cvd(withDelta.slice(-Math.min(withDelta.length, 15))));
  const vp = vol ? volumeProfile(bars.slice(-120)) : null;
  r.volume_profile = vp ? ok(vp) : no(opts.volumeSource ? "bars missing volume" : "no traded-volume source for this market");
  return r;
}

export function availabilitySummary(r: IndicatorReport) {
  const available = Object.entries(r).filter(([, m]) => m.available).map(([k]) => k);
  const unavailable = Object.fromEntries(Object.entries(r).filter(([, m]) => !m.available).map(([k, m]) => [k, (m as { reason: string }).reason]));
  return { available, unavailable };
}
