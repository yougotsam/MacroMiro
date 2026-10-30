/**
 * One feature vector per closed 15-minute bar. Every value is oriented so that positive means "up"
 * and bounded to roughly −1..+1, so a weight's sign and size read plainly. Built in one pass per series.
 * The same function feeds the backtest and the live desk, so what was measured is what trades.
 */
import { adrUsedSeries, atrSeries, emaSeries, rsiDivergence, rsiSeries, sessionVwapSeries, type Bar } from "./ta";
import { liquiditySweepAt, openFvgAt, premiumDiscountAt, structureAt } from "./smc";
import { inKillzone, sessionOf } from "./session";
import { releaseProximity } from "./news";
import type { NewsRead } from "./news";

export const FEATURES = [
  "mom1", "mom4", "ema_stack", "tunnel", "tunnel_stack", "rsi", "rsi_div",
  "sweep", "bos", "choch", "fvg", "ob_retest", "premium_discount", "vwap",
  "adr_exhaust", "kz_sweep", "kz_mom", "ny_mom", "london_mom", "release_mom",
  "news_spark", "news_rates", "mirofish",
] as const;
export type FeatureName = (typeof FEATURES)[number];
export type Vector = Record<FeatureName, number>;

/** Bars needed before the first vector (the 800 EMA of the MMM tunnel). */
export const WARMUP = 800;

const clip = (x: number, a = 1) => (Number.isFinite(x) ? Math.max(-a, Math.min(a, x)) : 0);
const sgn = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);

export type SeriesCache = {
  bars: Bar[];
  e9: (number | null)[]; e21: (number | null)[]; e50: (number | null)[];
  e13: (number | null)[]; e200: (number | null)[]; e800: (number | null)[];
  rsi: (number | null)[]; atr: (number | null)[]; vwap: number[];
  adr: { used: (number | null)[]; dayMove: number[] };
};

export function cacheOf(bars: Bar[]): SeriesCache {
  const c = bars.map((b) => b.c);
  return {
    bars, e9: emaSeries(c, 9), e21: emaSeries(c, 21), e50: emaSeries(c, 50), e13: emaSeries(c, 13), e200: emaSeries(c, 200), e800: emaSeries(c, 800),
    rsi: rsiSeries(c, 14), atr: atrSeries(bars, 14), vwap: sessionVwapSeries(bars), adr: adrUsedSeries(bars, 14),
  };
}

const NO_NEWS: NewsRead = { sparkBias: 0, sparkPresent: false, ratesTilt: 0, ratesPresent: false, mirofishP: null, mirofishState: "missing" };

/**
 * Vector at bar i (decided at that bar's close). Null during warm-up or when ATR is zero.
 * `releases` are tier-1 release times; `news` is the live read (history has none, so it is zero there).
 */
export function vectorAt(s: SeriesCache, i: number, releases: number[] = [], news: NewsRead = NO_NEWS): Vector | null {
  if (i < WARMUP - 1 || i >= s.bars.length) return null;
  const b = s.bars;
  const atr = s.atr[i];
  const [e9, e21, e50, e13, e200, e800, r] = [s.e9[i], s.e21[i], s.e50[i], s.e13[i], s.e200[i], s.e800[i], s.rsi[i]];
  if (!atr || !(atr > 0) || e9 == null || e21 == null || e50 == null || e13 == null || e200 == null || e800 == null || r == null) return null;
  const closeMs = b[i].t + 15 * 60_000;
  const mom1 = clip((b[i].c - b[i - 1].c) / atr, 3) / 3;
  const mom4 = clip((b[i].c - b[i - 4].c) / atr / 2, 3) / 3;
  const st = structureAt(b, i);
  const sweep = liquiditySweepAt(b, i);
  const kz = inKillzone(closeMs) ? 1 : 0;
  const sess = sessionOf(closeMs);
  const used = s.adr.used[i];
  const prox = releaseProximity(releases, closeMs);
  return {
    mom1,
    mom4,
    ema_stack: e9 > e21 && e21 > e50 ? 1 : e9 < e21 && e21 < e50 ? -1 : 0,
    tunnel: clip((b[i].c - e200) / atr / 10),
    tunnel_stack: e13 > e50 && e50 > e200 && e200 > e800 ? 1 : e13 < e50 && e50 < e200 && e200 < e800 ? -1 : 0,
    rsi: clip((r - 50) / 50),
    rsi_div: rsiDivergence(b, s.rsi, i),
    sweep,
    bos: st.bos,
    choch: st.choch,
    fvg: openFvgAt(b, i),
    ob_retest: st.obRetest,
    premium_discount: clip(premiumDiscountAt(b, i)),
    vwap: clip((b[i].c - s.vwap[i]) / atr / 4),
    adr_exhaust: used == null ? 0 : clip(Math.max(0, used - 0.7) / 0.6) * sgn(s.adr.dayMove[i]),
    kz_sweep: kz * sweep,
    kz_mom: kz * mom1,
    ny_mom: sess === "ny_am" || sess === "ny_pm" ? mom1 : 0,
    london_mom: sess === "london" ? mom1 : 0,
    release_mom: prox * mom1,
    news_spark: clip(news.sparkBias),
    news_rates: clip(news.ratesTilt * 2),
    mirofish: news.mirofishP == null ? 0 : clip((news.mirofishP - 0.5) * 2),
  };
}

export function toArray(v: Vector): number[] {
  return FEATURES.map((f) => v[f]);
}
