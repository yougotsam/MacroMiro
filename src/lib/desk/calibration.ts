/**
 * AURIX-X P1 probability validation (report-only). Joins the desk's own decision ledger to settled
 * outcomes, one observation per contract per time-to-close bucket, splits by close time with a purge
 * gap (no contract or overlapping window on both sides), fits a 2-parameter logistic recalibration on
 * the TRAIN part only, and scores the TEST part against the Kalshi mid price and a base-rate benchmark.
 * It also replays the gate's taker rule on the test part at the real ask with the real quadratic fee.
 *
 * Nothing here changes CALIBRATED_MODEL_APPROVED or any trading rule. `verdict` only says whether the
 * evidence would even be worth a human review; it can never turn trading on.
 */
import { TAKER_MIN_EDGE } from "./config";
import { quadraticFee } from "./fees";

export type LedgerRow = {
  ts: string; ticker: string | null; close: string | null; tte_s: number | null;
  p: number | null; p_base: number | null; quotes: Record<string, number | null> | null; model?: string;
};
export type OutcomeRow = { ticker: string; result: string };
export type Obs = {
  ticker: string; series: string; closeMs: number; tteBucket: number; tte: number;
  p: number; pBase: number; yesBid: number; yesAsk: number; mid: number; y: 0 | 1;
};

export const TTE_BUCKETS = [600, 300, 120, 45];
const ok01 = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0 && x < 1;

/** One row per (contract, bucket): the decision whose time-to-close is nearest the bucket, within 25 %. */
export function joinObservations(rows: LedgerRow[], outcomes: OutcomeRow[], buckets = TTE_BUCKETS): Obs[] {
  const result = new Map<string, 0 | 1>();
  for (const o of outcomes) if (o.result === "yes" || o.result === "no") result.set(o.ticker, o.result === "yes" ? 1 : 0);
  const best = new Map<string, { d: number; o: Obs }>();
  for (const r of rows) {
    if (!r.ticker || !r.close || r.tte_s == null || !result.has(r.ticker)) continue;
    const q = r.quotes ?? {};
    const yesBid = q.yes_bid, yesAsk = q.yes_ask;
    if (!ok01(r.p) || !ok01(r.p_base) || !ok01(yesBid) || !ok01(yesAsk) || !(yesBid < yesAsk)) continue;
    const closeMs = Date.parse(r.close);
    if (!Number.isFinite(closeMs)) continue;
    for (const b of buckets) {
      const d = Math.abs(r.tte_s - b);
      if (d > 0.25 * b) continue;
      const k = `${r.ticker}|${b}`;
      const prev = best.get(k);
      if (prev && prev.d <= d) continue;
      best.set(k, {
        d,
        o: { ticker: r.ticker, series: r.ticker.split("-")[0], closeMs, tteBucket: b, tte: r.tte_s, p: r.p, pBase: r.p_base,
          yesBid, yesAsk, mid: (yesBid + yesAsk) / 2, y: result.get(r.ticker)! },
      });
    }
  }
  return [...best.values()].map((x) => x.o).sort((a, b) => a.closeMs - b.closeMs || b.tteBucket - a.tteBucket);
}

/**
 * Temporal split on close time. Everything closing in the purge gap before the test start is dropped,
 * so no contract (and no overlapping 15-minute window) appears on both sides.
 */
export function purgedSplit(obs: Obs[], trainFrac = 0.6, purgeMs = 30 * 60_000) {
  const closes = [...new Set(obs.map((o) => o.closeMs))].sort((a, b) => a - b);
  if (closes.length < 3) return { train: [] as Obs[], test: [] as Obs[], cut: null as number | null };
  const cut = closes[Math.min(closes.length - 1, Math.max(1, Math.floor(closes.length * trainFrac)))];
  return { train: obs.filter((o) => o.closeMs < cut - purgeMs), test: obs.filter((o) => o.closeMs >= cut), cut };
}

const clip = (p: number) => Math.min(1 - 1e-6, Math.max(1e-6, p));
const logit = (p: number) => Math.log(clip(p) / (1 - clip(p)));
const sigm = (z: number) => 1 / (1 + Math.exp(-z));

export function brier(ps: number[], ys: number[]) {
  return ps.reduce((a, p, i) => a + (p - ys[i]) ** 2, 0) / ps.length;
}
export function logLoss(ps: number[], ys: number[]) {
  return -ps.reduce((a, p, i) => a + (ys[i] ? Math.log(clip(p)) : Math.log(1 - clip(p))), 0) / ps.length;
}
/** Reliability table: mean forecast vs observed frequency per probability decile. */
export function reliability(ps: number[], ys: number[], bins = 10) {
  const out: Array<{ lo: number; hi: number; n: number; meanP: number; freq: number }> = [];
  for (let k = 0; k < bins; k += 1) {
    const lo = k / bins, hi = (k + 1) / bins;
    const idx = ps.map((p, i) => [p, i] as const).filter(([p]) => p >= lo && (k === bins - 1 ? p <= hi : p < hi)).map(([, i]) => i);
    if (!idx.length) continue;
    out.push({ lo, hi, n: idx.length, meanP: idx.reduce((a, i) => a + ps[i], 0) / idx.length, freq: idx.reduce((a, i) => a + ys[i], 0) / idx.length });
  }
  return out;
}

/** Platt-style recalibration p' = σ(a·logit(p) + b), fitted by Newton steps with a small ridge on (a−1, b). */
export function fitRecalibration(ps: number[], ys: number[], iters = 50, ridge = 1e-3) {
  let a = 1, b = 0;
  for (let it = 0; it < iters; it += 1) {
    let ga = ridge * (a - 1), gb = ridge * b, haa = ridge, hab = 0, hbb = ridge;
    for (let i = 0; i < ps.length; i += 1) {
      const x = logit(ps[i]);
      const q = sigm(a * x + b);
      const r = q - ys[i], w = q * (1 - q);
      ga += r * x; gb += r; haa += w * x * x; hab += w * x; hbb += w;
    }
    const det = haa * hbb - hab * hab;
    if (!(Math.abs(det) > 1e-12)) break;
    const da = (hbb * ga - hab * gb) / det, db = (haa * gb - hab * ga) / det;
    a -= da; b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return { a, b, apply: (p: number) => sigm(a * logit(p) + b) };
}

/**
 * Hypothetical taker replay at the recorded ask with the real quadratic fee and the gate's 4¢ taker
 * minimum. One contract per signal; maker fills are NOT simulated (queue position is unknown).
 */
export function takerReplay(obs: Obs[], prob: (o: Obs) => number, minEdge = TAKER_MIN_EDGE, safety = 0.02) {
  const pnl: number[] = [];
  for (const o of obs) {
    const p = prob(o);
    const yesPx = o.yesAsk, noPx = 1 - o.yesBid;
    const eYes = p - safety - yesPx - quadraticFee(1, yesPx);
    const eNo = 1 - p - safety - noPx - quadraticFee(1, noPx);
    if (Math.max(eYes, eNo) < minEdge) continue;
    if (eYes >= eNo) pnl.push((o.y ? 1 : 0) - yesPx - quadraticFee(1, yesPx));
    else pnl.push((o.y ? 0 : 1) - noPx - quadraticFee(1, noPx));
  }
  const n = pnl.length;
  const mean = n ? pnl.reduce((a, x) => a + x, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(pnl.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return { trades: n, total: Number((mean * n).toFixed(4)), mean: Number(mean.toFixed(4)), se: n > 1 ? Number((sd / Math.sqrt(n)).toFixed(4)) : null };
}

export type ValidationReport = ReturnType<typeof validate>;
export function validate(obs: Obs[], opts: { trainFrac?: number; purgeMs?: number } = {}) {
  const { train, test, cut } = purgedSplit(obs, opts.trainFrac, opts.purgeMs);
  const ys = test.map((o) => o.y);
  const fit = train.length >= 30 ? fitRecalibration(train.map((o) => o.p), train.map((o) => o.y)) : null;
  const baseRate = train.length ? train.reduce((a, o) => a + o.y, 0) / train.length : 0.5;
  const score = (ps: number[]) => (ps.length ? { brier: Number(brier(ps, ys).toFixed(5)), logLoss: Number(logLoss(ps, ys).toFixed(5)) } : null);
  const report = {
    contracts: { all: new Set(obs.map((o) => o.ticker)).size, train: new Set(train.map((o) => o.ticker)).size, test: new Set(test.map((o) => o.ticker)).size },
    observations: { all: obs.length, train: train.length, test: test.length },
    testStarts: cut != null ? new Date(cut).toISOString() : null,
    test: {
      model: score(test.map((o) => o.p)),
      modelBase: score(test.map((o) => o.pBase)),
      recalibrated: fit ? score(test.map((o) => fit.apply(o.p))) : null,
      marketMid: score(test.map((o) => o.mid)),
      baseRate: score(test.map(() => baseRate)),
    },
    recalibration: fit ? { a: Number(fit.a.toFixed(4)), b: Number(fit.b.toFixed(4)) } : null,
    reliability: reliability(test.map((o) => o.p), ys),
    afterCostTaker: {
      model: takerReplay(test, (o) => o.p),
      recalibrated: fit ? takerReplay(test, (o) => fit.apply(o.p)) : null,
    },
  };
  return { ...report, verdict: verdict(report) };
}

/** Review-worthiness only. Never flips the release gate. */
export function verdict(r: {
  contracts: { test: number };
  test: { model: { brier: number } | null; marketMid: { brier: number } | null };
  afterCostTaker: { model: { trades: number; mean: number; se: number | null } };
}) {
  const reasons: string[] = [];
  if (r.contracts.test < 500) reasons.push(`only ${r.contracts.test} test contracts (< 500)`);
  if (!r.test.model || !r.test.marketMid || r.test.model.brier >= r.test.marketMid.brier) reasons.push("model does not beat the Kalshi mid on Brier");
  const t = r.afterCostTaker.model;
  if (t.trades < 100 || t.se == null || t.mean - 2 * t.se <= 0) reasons.push("after-cost taker P/L not positive at 2 standard errors over ≥100 trades");
  return { worthHumanReview: reasons.length === 0, reasons, releaseGateUnchanged: true as const };
}
