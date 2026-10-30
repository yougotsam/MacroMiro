/**
 * Perpetuals backtest that trades Sameer's rules, not a one-bar guess.
 *
 * Rules (src/lib/perps/flip-plan.ts + src/lib/desk/guard.ts):
 *   - bracket: stop at the sweep / zone, half off at 1R, stop to entry, then trail 1R behind the best price,
 *     the rest off at the target multiple; max hold (8h in the live plan; 1h/4h/24h tested too)
 *   - size so a stop costs 8% of the pile (TRADE_FRAC), notional capped at MAX_LEVERAGE × pile
 *   - three losses in a row end the (New York) day; a 25% hole in the pile stops the series for good
 * Fills:
 *   - entry is a resting limit on the bid (long) / ask (short), filled only if price trades THROUGH it within
 *     ENTRY_WAIT bars; take-profits rest on the ask (long) / bid (short), same trade-through rule (maker fee)
 *   - stops and time exits are market orders: taker fee, cross the half spread, plus slippage; a gap through the
 *     stop fills at the bar open. If a bar touches stop and target, the stop is assumed first.
 * Costs (Kalshi perps schedule, tier 0): crypto maker 0.02% / taker 0.04%; metals maker 0.0012% / taker 0.0024%.
 * Funding: charged at 00/08/16 New York; rate = the OKX print for the same asset (Kalshi's own history answers 403
 * here), set to 0 below 0.01% and capped at ±2% like Kalshi; × `fundingMult` for the sensitivity run.
 * No look-ahead: every decision at bar i uses bars ≤ i and only completed 1H / 4H bars.
 */
import { emaSeries, rsiSeries, atrSeries, type Bar } from "./ta";
import { liquiditySweepAt, openFvgAt, structureAt } from "./smc";
import { inKillzone, nyClock } from "./session";
import { toneZAt as toneZ } from "./news";
import { KILL_FRAC, LOSS_STREAK, TRADE_FRAC } from "../desk/guard";

export const PERP_COSTS = Object.freeze({
  crypto: { maker: 0.0002, taker: 0.0004, halfSpread: 0.0001, slip: 0.0001 },
  metal: { maker: 0.000012, taker: 0.000024, halfSpread: 0.00005, slip: 0.00005 },
});
export const MAX_LEVERAGE = 5;
export const ENTRY_WAIT = 4;
const M15 = 15 * 60_000;
const H1 = 3_600_000;
const H4 = 4 * H1;

export type Strategy = "sameer" | "aeiou";
export type PerpParams = {
  strategy: Strategy;
  maxHoldMs: number;
  /** take-profit multiples: tp1 (partial) and tp2 (rest), in R */
  tp1: number;
  tp2: number;
  partialFrac: number;
  trailR: number | null;
  fundingMult: number;
  /** skip entries this many minutes before/after a tier-1 release (null = no news block) */
  newsBlock: { before: number; after: number } | null;
  /** skip a long when the asset's headline tone is this many z below normal (and the mirror for shorts); null = off */
  toneVeto: number | null;
};

export type Fund = { t: number; rate: number };
export type PerpTrade = {
  t: number; side: 1 | -1; entry: number; exit: number; r: number; pnl: number; fees: number; funding: number;
  equityAfter: number; how: string; holdMin: number;
};
export type PerpResult = {
  asset: string; params: PerpParams; trades: PerpTrade[]; signals: number; unfilled: number;
  startEquity: number; endEquity: number; returnPct: number; feesPct: number; fundingPct: number;
  winRate: number; maxDrawdownPct: number; halted: boolean; daysStopped: number; avgR: number;
};

/** Kalshi funding rule applied to a raw rate. */
export function kalshiFunding(rate: number): number {
  if (!Number.isFinite(rate) || Math.abs(rate) < 0.0001) return 0;
  return Math.max(-0.02, Math.min(0.02, rate));
}

/** Funding instants (00/08/16 New York) strictly after `from` and at/before `to`. */
export function fundingTimes(from: number, to: number): number[] {
  const out: number[] = [];
  for (let t = Math.floor(from / M15) * M15 + M15; t <= to; t += M15) {
    const { mins } = nyClock(t);
    if (mins === 0 || mins === 480 || mins === 960) out.push(t);
  }
  return out;
}

function rateAt(funds: Fund[], t: number, fallback: number): number {
  let lo = 0, hi = funds.length - 1, best = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (funds[m].t <= t) { best = m; lo = m + 1; } else hi = m - 1;
  }
  return best >= 0 && t - funds[best].t < 12 * H1 ? funds[best].rate : fallback;
}

/** Completed higher-timeframe bars and, for each 15m bar, the index of the last one closed by that bar's close. */
export function aggregate(b: Bar[], span: number): { bars: Bar[]; lastClosed: number[] } {
  const bars: Bar[] = [];
  const lastClosed: number[] = new Array(b.length).fill(-1);
  let cur: Bar | null = null;
  let curKey = -1;
  for (let i = 0; i < b.length; i++) {
    const key = Math.floor(b[i].t / span);
    if (key !== curKey) {
      if (cur) bars.push(cur);
      cur = { t: key * span, o: b[i].o, h: b[i].h, l: b[i].l, c: b[i].c, v: b[i].v ?? 0 };
      curKey = key;
    } else if (cur) {
      cur.h = Math.max(cur.h, b[i].h); cur.l = Math.min(cur.l, b[i].l); cur.c = b[i].c; cur.v = (cur.v ?? 0) + (b[i].v ?? 0);
    }
    const closesBucket = b[i].t + M15 >= (key + 1) * span;
    if (closesBucket && cur) { bars.push(cur); cur = null; curKey = -1; }
    lastClosed[i] = bars.length - 1;
  }
  return { bars, lastClosed };
}

type Zone = { dir: 1 | -1; lo: number; hi: number; born: number };

/** Active 4H order blocks and fair-value gaps after each completed 4H bar (AEIOU #31/#44). */
export function zones4h(h4: Bar[]): Zone[][] {
  const out: Zone[][] = [];
  let live: Zone[] = [];
  for (let k = 0; k < h4.length; k++) {
    const c = h4[k];
    if (k >= 2) {
      if (h4[k - 2].h < c.l) live.push({ dir: 1, lo: h4[k - 2].h, hi: c.l, born: k });
      if (h4[k - 2].l > c.h) live.push({ dir: -1, lo: c.h, hi: h4[k - 2].l, born: k });
    }
    if (k >= 11) {
      let hi = -Infinity, lo = Infinity;
      for (let j = k - 10; j < k; j++) { hi = Math.max(hi, h4[j].h); lo = Math.min(lo, h4[j].l); }
      if (c.c > hi) for (let j = k - 1; j >= k - 5; j--) if (h4[j].c < h4[j].o) { live.push({ dir: 1, lo: h4[j].l, hi: h4[j].h, born: k }); break; }
      if (c.c < lo) for (let j = k - 1; j >= k - 5; j--) if (h4[j].c > h4[j].o) { live.push({ dir: -1, lo: h4[j].l, hi: h4[j].h, born: k }); break; }
    }
    live = live.filter((z) => k - z.born <= 30 && !(z.dir === 1 && c.c < z.lo) && !(z.dir === -1 && c.c > z.hi));
    out.push(live.slice());
  }
  return out;
}

export type Signal = { i: number; side: 1 | -1; stop: number; why: string };

/** Sameer's automatic setup (flip-plan bias): a swept low + bullish gap + funding not charging longs (mirror for shorts). */
export function sameerSignals(b: Bar[], funds: Fund[], fallbackRate: number): Signal[] {
  const out: Signal[] = [];
  for (let i = 30; i < b.length; i++) {
    const sweep = liquiditySweepAt(b, i);
    if (!sweep) continue;
    const gap = openFvgAt(b, i);
    const f = rateAt(funds, b[i].t + M15, fallbackRate);
    if (sweep === 1 && gap === 1 && f < 0.0005) {
      let lo = Infinity; for (let j = i - 2; j <= i; j++) lo = Math.min(lo, b[j].l);
      out.push({ i, side: 1, stop: lo, why: "swept low + gap up" });
    } else if (sweep === -1 && gap === -1 && f > -0.0005) {
      let hi = -Infinity; for (let j = i - 2; j <= i; j++) hi = Math.max(hi, b[j].h);
      out.push({ i, side: -1, stop: hi, why: "swept high + gap down" });
    }
  }
  return out;
}

/**
 * AEIOU #44 (crypto) / #31 (gold) / #100: 4H bias + 4H OB/FVG touch, 15m trigger, killzone only.
 * crypto long: 4H EMA21 > EMA50, 15m price in a bullish 4H zone, 15m ChoCH up, 1H RSI > 45.
 * gold long: 15m price in a bullish 4H zone, 1H RSI crossed back above 40 from below 30–35, 15m EMA 9 crossed above 21.
 * Shorts mirror. Stop beyond the zone by 0.1 ATR(15m).
 */
export function aeiouSignals(b: Bar[], kind: "crypto" | "metal"): Signal[] {
  const out: Signal[] = [];
  const h1 = aggregate(b, H1);
  const h4 = aggregate(b, H4);
  const h4c = h4.bars.map((x) => x.c);
  const e21h4 = emaSeries(h4c, 21), e50h4 = emaSeries(h4c, 50);
  const rsiH1 = rsiSeries(h1.bars.map((x) => x.c), 14);
  const c15 = b.map((x) => x.c);
  const e9 = emaSeries(c15, 9), e21 = emaSeries(c15, 21);
  const atr = atrSeries(b, 14);
  const zones = zones4h(h4.bars);
  for (let i = 60; i < b.length; i++) {
    const closeMs = b[i].t + M15;
    if (!inKillzone(closeMs)) continue;
    const k4 = h4.lastClosed[i], k1 = h1.lastClosed[i];
    if (k4 < 55 || k1 < 20 || atr[i] == null) continue;
    const zs = zones[k4];
    for (const side of [1, -1] as const) {
      const z = zs.find((x) => x.dir === side && b[i].l <= x.hi && b[i].h >= x.lo);
      if (!z) continue;
      let ok = false;
      if (kind === "crypto") {
        const trend = e21h4[k4] != null && e50h4[k4] != null && (side === 1 ? e21h4[k4]! > e50h4[k4]! : e21h4[k4]! < e50h4[k4]!);
        const r = rsiH1[k1];
        const choch = structureAt(b, i).choch === side;
        ok = trend && choch && r != null && (side === 1 ? r > 45 : r < 55);
      } else {
        const r = rsiH1[k1];
        let extreme = false;
        for (let j = Math.max(0, k1 - 6); j < k1; j++) { const x = rsiH1[j]; if (x != null && (side === 1 ? x < 35 : x > 65)) extreme = true; }
        const crossed = r != null && (side === 1 ? r > 40 : r < 60);
        let ema = false;
        for (let j = i - 2; j <= i; j++) {
          const [a0, b0, a1, b1] = [e9[j - 1], e21[j - 1], e9[j], e21[j]];
          if (a0 != null && b0 != null && a1 != null && b1 != null && (side === 1 ? a0 <= b0 && a1 > b1 : a0 >= b0 && a1 < b1)) ema = true;
        }
        ok = extreme && crossed && ema;
      }
      if (!ok) continue;
      const pad = 0.1 * atr[i]!;
      out.push({ i, side, stop: side === 1 ? z.lo - pad : z.hi + pad, why: kind === "crypto" ? "#44 zone+ChoCH+RSI+4H EMA" : "#31 zone+RSI+EMA cross" });
      break;
    }
  }
  return out;
}

/** Minutes from the nearest tier-1 release (negative = before). */
function minutesFromRelease(releases: number[], t: number): number {
  let best = Infinity;
  for (const r of releases) { const d = (t - r) / 60_000; if (Math.abs(d) < Math.abs(best)) best = d; }
  return best;
}

export function runPerps(input: {
  asset: string; kind: "crypto" | "metal"; bars: Bar[]; funds: Fund[]; releases: number[];
  tone?: { t: number; tone: number }[]; params: PerpParams; startEquity?: number; signals?: Signal[];
}): PerpResult {
  const { bars: b, params: P, kind } = input;
  const cost = PERP_COSTS[kind];
  const fallback = input.funds.length ? [...input.funds].map((f) => f.rate).sort((x, y) => x - y)[input.funds.length >> 1] : 0.0001;
  const sigs = input.signals ?? (P.strategy === "sameer" ? sameerSignals(b, input.funds, fallback) : aeiouSignals(b, kind));
  const start = input.startEquity ?? 1000;
  let eq = start, peak = start, maxDd = 0, feesTot = 0, fundTot = 0, unfilled = 0, daysStopped = 0;
  let halted = false;
  const trades: PerpTrade[] = [];
  let busyUntil = -1;
  let streak = 0;
  let dayKey = "";
  let dayDone = false;
  const nyDay = (ms: number) => new Date(ms - 4 * H1).toISOString().slice(0, 10);
  for (const s of sigs) {
    if (halted) break;
    if (s.i <= busyUntil) continue;
    const t0 = b[s.i].t + M15;
    const d = nyDay(t0);
    if (d !== dayKey) { dayKey = d; dayDone = false; streak = 0; }
    if (dayDone) continue;
    if (P.newsBlock) {
      const m = minutesFromRelease(input.releases, t0);
      if (m >= -P.newsBlock.before && m <= P.newsBlock.after) continue;
    }
    if (P.toneVeto != null && input.tone) {
      const z = toneZ(input.tone, t0);
      if (z != null && (s.side === 1 ? z < -P.toneVeto : z > P.toneVeto)) continue;
    }
    const side = s.side;
    const limit = b[s.i].c * (1 - side * cost.halfSpread);
    const R = side === 1 ? limit - s.stop : s.stop - limit;
    if (!(R > 0) || R / limit < 0.0005) continue;
    // fill: price must trade through the limit within ENTRY_WAIT bars
    let fi = -1;
    for (let j = s.i + 1; j <= Math.min(b.length - 1, s.i + ENTRY_WAIT); j++) {
      if (side === 1 ? b[j].l < limit * (1 - 0.00005) : b[j].h > limit * (1 + 0.00005)) { fi = j; break; }
      if (side === 1 ? b[j].l <= s.stop : b[j].h >= s.stop) break;
    }
    if (fi < 0) { unfilled++; busyUntil = s.i + ENTRY_WAIT; continue; }
    const riskCash = eq * TRADE_FRAC;
    let qty = riskCash / (R + limit * (cost.maker + cost.taker + cost.halfSpread + cost.slip));
    qty = Math.min(qty, (eq * MAX_LEVERAGE) / limit);
    let fees = qty * limit * cost.maker;
    let pnl = 0, funding = 0, open = qty, stop = s.stop, best = limit, took1 = false, how = "time";
    const tp1 = limit + side * P.tp1 * R, tp2 = limit + side * P.tp2 * R;
    const endT = b[fi].t + P.maxHoldMs;
    let j = fi;
    let exitPx = limit;
    const close = (px: number, q: number, fee: number) => { pnl += side * (px - limit) * q; fees += q * px * fee; open -= q; exitPx = px; };
    // the fill bar itself: only the stop can hit after the fill (conservative)
    for (; j < b.length && open > 1e-12; j++) {
      const x = b[j];
      if (j > fi) {
        // funding prints during this bar
        for (const ft of fundingTimes(x.t, x.t + M15)) {
          const r = kalshiFunding(rateAt(input.funds, ft, fallback)) * P.fundingMult;
          const f = side * r * open * x.o; // longs pay positive funding
          funding += f;
        }
      }
      const hitStop = side === 1 ? x.l <= stop : x.h >= stop;
      if (hitStop) {
        const gap = side === 1 ? x.o < stop : x.o > stop;
        const px = (gap && j > fi ? x.o : stop) * (1 - side * (cost.halfSpread + cost.slip));
        close(px, open, cost.taker);
        how = took1 ? "trail/breakeven" : "stop";
        break;
      }
      if (j === fi) continue;
      if (!took1 && (side === 1 ? x.h > tp1 * (1 + 0.00005) : x.l < tp1 * (1 - 0.00005))) {
        close(tp1, open * P.partialFrac, cost.maker);
        took1 = true;
        stop = side === 1 ? Math.max(stop, limit) : Math.min(stop, limit);
      }
      if (took1 && (side === 1 ? x.h > tp2 * (1 + 0.00005) : x.l < tp2 * (1 - 0.00005))) {
        close(tp2, open, cost.maker);
        how = "target";
        break;
      }
      best = side === 1 ? Math.max(best, x.h) : Math.min(best, x.l);
      if (took1 && P.trailR != null) {
        const trail = best - side * P.trailR * R;
        stop = side === 1 ? Math.max(stop, trail) : Math.min(stop, trail);
      }
      if (x.t + M15 >= endT) {
        close(x.c * (1 - side * cost.halfSpread), open, cost.taker);
        how = "time";
        break;
      }
    }
    if (open > 1e-12) { const x = b[b.length - 1]; close(x.c * (1 - side * cost.halfSpread), open, cost.taker); how = "end of data"; j = b.length - 1; }
    const net = pnl - fees - funding;
    eq += net;
    feesTot += fees; fundTot += funding;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, (peak - eq) / peak);
    trades.push({ t: t0, side, entry: limit, exit: exitPx, r: net / (qty * R), pnl: net, fees, funding, equityAfter: eq, how, holdMin: (Math.min(j, b.length - 1) - fi + 1) * 15 });
    busyUntil = j;
    streak = net < 0 ? streak + 1 : 0;
    if (streak >= LOSS_STREAK) { dayDone = true; daysStopped++; }
    if (eq <= start * (1 - KILL_FRAC)) halted = true;
  }
  const wins = trades.filter((t) => t.pnl > 0).length;
  return {
    asset: input.asset, params: P, trades, signals: sigs.length, unfilled, startEquity: start, endEquity: eq,
    returnPct: (eq / start - 1) * 100, feesPct: (feesTot / start) * 100, fundingPct: (fundTot / start) * 100,
    winRate: trades.length ? wins / trades.length : 0, maxDrawdownPct: maxDd * 100, halted, daysStopped,
    avgR: trades.length ? trades.reduce((a, t) => a + t.r, 0) / trades.length : 0,
  };
}

export const BASE_PARAMS: PerpParams = Object.freeze({
  strategy: "sameer", maxHoldMs: 8 * H1, tp1: 1, tp2: 2.5, partialFrac: 0.5, trailR: 1, fundingMult: 1, newsBlock: null, toneVeto: null,
}) as PerpParams;
