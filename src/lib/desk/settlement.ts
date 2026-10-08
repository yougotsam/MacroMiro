/**
 * Settlement probability (priority #1). Martingale baseline: the reference index has ~0 drift
 * over minutes, so P comes from distance-to-strike, time left and short-horizon volatility only.
 *
 * Crypto (KXBTC/ETH/SOL/XRP15M): value = simple average of the 60 one-second CF RTI prints at
 *   t ∈ [close−60s, close−1s], rounded to dp; YES iff value ≥ floor_strike.
 * Gold (KXGOLD15M): value = Pyth 1-minute candle close at close time (price at close), rounded; YES iff ≥ strike.
 */
import { P_CLAMP } from "./config";

export function normCdf(x: number) {
  // Abramowitz–Stegun 7.1.26 via erf, |err| < 1.5e-7
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

export type Print = { t: number; v: number }; // t = ms (whole second), v = index value

export type CryptoInput = {
  closeMs: number;
  strike: number;
  dp: number;
  /** latest print (the "now" of the model) */
  last: Print;
  /** prints already observed inside the settlement window (keyed by second) */
  windowPrints: Map<number, number>;
  /** per-second log-return std */
  sigma: number;
};

export type SettleModel = { p: number; mean: number; sd: number; printed: number; future: number; why: string };

/** Σ_{i,j=1..n} min(d+i, d+j) = n²d + n(n+1)(2n+1)/6 */
export function sumMinCov(n: number, d: number) {
  return n * n * d + (n * (n + 1) * (2 * n + 1)) / 6;
}

export function cryptoProb(x: CryptoInput): SettleModel {
  const closeSec = Math.floor(x.closeMs / 1000);
  const lastSec = Math.floor(x.last.t / 1000);
  let printedSum = 0;
  let printed = 0;
  let future = 0;
  let firstFuture: number | null = null;
  for (let s = closeSec - 60; s < closeSec; s += 1) {
    if (s <= lastSec) {
      // already printed: use the recorded print; a missing second falls back to the latest value we hold
      const v = x.windowPrints.get(s * 1000);
      printedSum += v ?? x.last.v;
      printed += 1;
    } else {
      if (firstFuture == null) firstFuture = s;
      future += 1;
    }
  }
  const mean = (printedSum + future * x.last.v) / 60;
  const kEff = x.strike - 0.5 * 10 ** -x.dp; // rounding to dp then ≥ strike
  if (future === 0) {
    const p = mean >= kEff ? 1 : 0;
    return { p, mean, sd: 0, printed, future, why: "all 60 prints locked" };
  }
  const d = (firstFuture as number) - lastSec - 1;
  const sd = (x.last.v * x.sigma * Math.sqrt(sumMinCov(future, d))) / 60;
  const p = sd > 0 ? normCdf((mean - kEff) / sd) : mean >= kEff ? 1 : 0;
  return { p, mean, sd, printed, future, why: printed > 0 ? `final minute: ${printed}/60 printed` : `window starts in ${d + 1}s` };
}

export type GoldInput = { closeMs: number; strike: number; dp: number; last: Print; sigma: number };

export function goldProb(x: GoldInput): SettleModel {
  const tau = Math.max(0, (x.closeMs - x.last.t) / 1000);
  const kEff = x.strike - 0.5 * 10 ** -x.dp;
  if (tau <= 0) return { p: x.last.v >= kEff ? 1 : 0, mean: x.last.v, sd: 0, printed: 1, future: 0, why: "close passed" };
  const sd = x.last.v * x.sigma * Math.sqrt(tau);
  return { p: normCdf((x.last.v - kEff) / sd), mean: x.last.v, sd, printed: 0, future: tau, why: `${Math.round(tau)}s to close` };
}

export function clampP(p: number) {
  return Math.min(P_CLAMP, Math.max(1 - P_CLAMP, p));
}

/**
 * Per-second sigma from 1-second prints: std of 10-second log returns / √10 over the recent
 * window, floored by 0.8× the longer window so a quiet 15 minutes can't understate risk.
 */
export function sigmaFromPrints(prints: Print[], nowMs: number, floor: number): { sigma: number | null; n: number } {
  const bySec = new Map<number, number>();
  for (const p of prints) bySec.set(Math.floor(p.t / 1000), p.v);
  const est = (spanSec: number) => {
    const end = Math.floor(nowMs / 1000);
    const rets: number[] = [];
    for (let s = end - spanSec; s + 10 <= end; s += 10) {
      const a = bySec.get(s);
      const b = bySec.get(s + 10);
      if (a && b) rets.push(Math.log(b / a));
    }
    if (rets.length < 6) return { s: null as number | null, n: rets.length };
    const m = rets.reduce((u, r) => u + r, 0) / rets.length;
    const v = rets.reduce((u, r) => u + (r - m) ** 2, 0) / (rets.length - 1);
    return { s: Math.sqrt(v / 10), n: rets.length };
  };
  const short = est(15 * 60);
  const long = est(60 * 60);
  if (short.s == null) return { sigma: null, n: short.n };
  const s = Math.max(short.s, long.s != null ? 0.8 * long.s : 0, floor);
  return { sigma: s, n: short.n };
}

/** Per-second sigma floors (conservative minimums). */
export const SIGMA_FLOOR: Record<string, number> = {
  BRTI: 2e-5,
  ETHUSD_RTI: 2.5e-5,
  SOLUSD_RTI: 3e-5,
  XRPUSD_RTI: 3e-5,
  "Metal.Index.1OZGOLD/USD": 4e-6,
};
