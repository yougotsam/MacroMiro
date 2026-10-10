/**
 * AURIX-X P1 probability validation (report-only). Joins the desk's own decision ledger to settled
 * outcomes, one observation per contract per time-to-close bucket, splits by close time with a purge
 * gap, fits a 2-parameter logistic recalibration on TRAIN only, and scores TEST against the Kalshi mid
 * and a base-rate benchmark — separately for every model version in the ledger.
 *
 * The taker replay runs the LIVE gate (`scoreSides`, taker only) on each recorded book, so it inherits
 * the exact edge rules, the 4–93¢ band, the last-minute 5¢ floor, the $3 budget and the displayed top-of-
 * book size, and it charges the event's actual fee multiplier. Rows without a recorded fee multiplier or
 * displayed size are NOT booked (counted as skipped). One entry per contract (the first that qualifies,
 * as the engine would), and uncertainty is clustered by 15-minute close window.
 *
 * Nothing here changes CALIBRATED_MODEL_APPROVED or any trading rule. `verdict` is advisory only.
 */
import { MAX_ORDER_COST_USD } from "./config";
import { scoreSides, type Book } from "./gate";
import { minPriceFor } from "./guard";

export type LedgerRow = {
  ts: string; ticker: string | null; close: string | null; tte_s: number | null;
  p: number | null; p_base: number | null; quotes: Record<string, number | null> | null; model?: string;
  /** displayed top-of-book sizes (recorded by the engine from fix/aurix-x onward) */
  depth?: { yes_bid_size: number | null; no_bid_size: number | null } | null;
  fee_multiplier?: number | null;
  fee_type?: string | null;
  spot?: number | null; strike?: number | null; sigma?: number | null;
};
export type OutcomeRow = { ticker: string; result: string };
export type Obs = {
  ticker: string; series: string; model: string; closeMs: number; tteBucket: number; tte: number;
  p: number; pBase: number; yesBid: number; yesAsk: number; mid: number; y: 0 | 1;
  /** sizes behind the YES bid and NO bid (the NO bid is the YES ask) — null when not recorded */
  yesBidSize: number | null; noBidSize: number | null;
  /** event-specific quadratic fee multiplier — null when unknown */
  feeMultiplier: number | null;
  /** baseline inputs: ln(S/K)/(σ√t) and ln(S/K)/√t — null when spot/strike/σ were not recorded */
  z?: number | null; dist?: number | null;
};

export const TTE_BUCKETS = [600, 300, 120, 45];
const ok01 = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x > 0 && x < 1;
const posOrNull = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : null);
export const eventOf = (ticker: string) => ticker.replace(/-[^-]+$/, "");

/**
 * One row per (model, contract, bucket): the decision whose time-to-close is nearest the bucket (within 25 %).
 * `fees` maps event ticker → actual multiplier; a value recorded on the row wins.
 */
export function joinObservations(rows: LedgerRow[], outcomes: OutcomeRow[], buckets = TTE_BUCKETS, fees: Map<string, number> = new Map()): Obs[] {
  const result = new Map<string, 0 | 1>();
  for (const o of outcomes) if (o.result === "yes" || o.result === "no") result.set(o.ticker, o.result === "yes" ? 1 : 0);
  const best = new Map<string, { d: number; o: Obs }>();
  for (const r of rows) {
    if (!r.ticker || !r.close || r.tte_s == null || !result.has(r.ticker)) continue;
    const q = r.quotes ?? {};
    const yesBid = q.yes_bid, noBid = q.no_bid;
    if (!ok01(r.p) || !ok01(r.p_base) || !ok01(yesBid) || !ok01(noBid)) continue;
    const yesAsk = Math.round((1 - noBid) * 10_000) / 10_000;
    if (!(yesBid < yesAsk)) continue;
    const closeMs = Date.parse(r.close);
    if (!Number.isFinite(closeMs)) continue;
    const model = r.model ?? "unknown";
    const feeMultiplier = r.fee_type && r.fee_type !== "quadratic" ? null : posOrNull(r.fee_multiplier) ?? fees.get(eventOf(r.ticker)) ?? null;
    for (const b of buckets) {
      const d = Math.abs(r.tte_s - b);
      if (d > 0.25 * b) continue;
      const k = `${model}|${r.ticker}|${b}`;
      const prev = best.get(k);
      if (prev && prev.d <= d) continue;
      best.set(k, {
        d,
        o: { ticker: r.ticker, series: r.ticker.split("-")[0], model, closeMs, tteBucket: b, tte: r.tte_s, p: r.p, pBase: r.p_base,
          yesBid, yesAsk, mid: (yesBid + yesAsk) / 2, y: result.get(r.ticker)!,
          yesBidSize: posOrNull(r.depth?.yes_bid_size), noBidSize: posOrNull(r.depth?.no_bid_size), feeMultiplier, ...baselineInputs(r) },
      });
    }
  }
  return [...best.values()].map((x) => x.o).sort((a, b) => a.closeMs - b.closeMs || b.tteBucket - a.tteBucket);
}

function baselineInputs(r: LedgerRow) {
  const S = r.spot, K = r.strike, sg = r.sigma, t = r.tte_s;
  if (!(typeof S === "number" && S > 0 && typeof K === "number" && K > 0 && typeof t === "number" && t > 0)) return { z: null, dist: null };
  const lr = Math.log(S / K);
  return { z: typeof sg === "number" && sg > 0 ? lr / (sg * Math.sqrt(t)) : null, dist: lr / Math.sqrt(t) };
}

/** Temporal split on close time; everything closing in the purge gap before the test start is dropped. */
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

/** Platt-style recalibration p' = σ(a·logit(p) + b), Newton steps with a small ridge on (a−1, b). */
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
 * Independent settlement cluster: BTC/ETH/SOL/XRP closing at the same time are ONE cluster (they move together);
 * gold closing at that time is its own cluster. Used for every CI/SE and every "windows" count.
 */
export function settlementCluster(closeMs: number, seriesOrTicker: string) {
  return closeMs * 2 + (/GOLD/i.test(seriesOrTicker) ? 1 : 0);
}

/** Cluster-robust standard error of the mean P/L per contract, clusters = close windows. */
export function clusteredSe(rows: Array<{ cluster: number; pnl: number }>) {
  const n = rows.length;
  if (n < 2) return null;
  const mean = rows.reduce((a, r) => a + r.pnl, 0) / n;
  const by = new Map<number, number>();
  for (const r of rows) by.set(r.cluster, (by.get(r.cluster) ?? 0) + (r.pnl - mean));
  const g = by.size;
  if (g < 2) return null;
  const s = [...by.values()].reduce((a, x) => a + x * x, 0);
  return Math.sqrt((g / (g - 1)) * s) / n;
}

export type ReplayTrade = { ticker: string; closeMs: number; side: "yes" | "no"; price: number; count: number; fee: number; pnl: number; tte: number };
/**
 * Taker replay through the live gate. Each contract is entered at most once (earliest qualifying bucket).
 * P/L is per contract-dollar outcome: count × (payout − price) − actual fee.
 */
export function takerReplay(obs: Obs[], prob: (o: Obs) => number, budget = MAX_ORDER_COST_USD, opts: { assumeDepth?: number } = {}) {
  const { trades, skipped } = takerTrades(obs, prob, budget, opts);
  return summarizeTrades(trades, skipped);
}

/** The individual replay trades (one per contract) — used by the per-market/strategy/bucket analysis. */
export function takerTrades(obs: Obs[], prob: (o: Obs) => number, budget = MAX_ORDER_COST_USD, opts: { assumeDepth?: number; accept?: (o: Obs, c: { side: "yes" | "no"; price: number; feePer: number }) => boolean } = {}) {
  const skipped = { feeUnknown: 0, depthUnknown: 0, gate: 0, alreadyEntered: 0, notAccepted: 0 };
  const trades: ReplayTrade[] = [];
  const entered = new Set<string>();
  const order = [...obs].sort((a, b) => a.closeMs - b.closeMs || b.tte - a.tte);
  for (const o of order) {
    if (entered.has(o.ticker)) { skipped.alreadyEntered += 1; continue; }
    if (o.feeMultiplier == null) { skipped.feeUnknown += 1; continue; }
    const yesSize = o.yesBidSize ?? opts.assumeDepth ?? null;
    const noSize = o.noBidSize ?? opts.assumeDepth ?? null;
    if (yesSize == null || noSize == null) { skipped.depthUnknown += 1; continue; }
    const p = prob(o);
    const book: Book = { yesBid: { price: o.yesBid, size: yesSize }, noBid: { price: Math.round((1 - o.yesAsk) * 10_000) / 10_000, size: noSize }, ts: o.closeMs - o.tte * 1000 };
    const g = scoreSides(p, o.pBase, book, { feeType: "quadratic", multiplier: o.feeMultiplier }, { allowMaker: false, allowTaker: true, budget, minPrice: minPriceFor(o.tte) });
    if (!g.best) { skipped.gate += 1; continue; }
    const b = g.best;
    if (opts.accept && !opts.accept(o, b)) { skipped.notAccepted += 1; continue; }
    const win = b.side === "yes" ? o.y === 1 : o.y === 0;
    trades.push({ ticker: o.ticker, closeMs: o.closeMs, side: b.side, price: b.price, count: b.count, fee: b.fee, tte: o.tte, pnl: b.count * ((win ? 1 : 0) - b.price) - b.fee });
    entered.add(o.ticker);
  }
  return { trades, skipped };
}

export function summarizeTrades(trades: ReplayTrade[], skipped: Record<string, number> = {}) {
  const n = trades.length;
  const total = trades.reduce((a, t) => a + t.pnl, 0);
  const mean = n ? total / n : 0;
  const naiveSe = n > 1 ? Math.sqrt(trades.reduce((a, t) => a + (t.pnl - mean) ** 2, 0) / (n - 1)) / Math.sqrt(n) : null;
  const cse = clusteredSe(trades.map((t) => ({ cluster: settlementCluster(t.closeMs, t.ticker), pnl: t.pnl })));
  const r4 = (x: number | null) => (x == null ? null : Number(x.toFixed(4)));
  return {
    trades: n, contracts: new Set(trades.map((t) => t.ticker)).size, windows: new Set(trades.map((t) => settlementCluster(t.closeMs, t.ticker))).size,
    total: Number(total.toFixed(4)), meanPerTrade: r4(mean), naiveSe: r4(naiveSe), clusteredSe: r4(cse), skipped,
  };
}

function validateOne(obs: Obs[], opts: { trainFrac?: number; purgeMs?: number }) {
  const { train, test, cut } = purgedSplit(obs, opts.trainFrac, opts.purgeMs);
  const ys = test.map((o) => o.y);
  const fit = train.length >= 30 ? fitRecalibration(train.map((o) => o.p), train.map((o) => o.y)) : null;
  const baseRate = train.length ? train.reduce((a, o) => a + o.y, 0) / train.length : 0.5;
  const score = (ps: number[]) => (ps.length ? { brier: Number(brier(ps, ys).toFixed(5)), logLoss: Number(logLoss(ps, ys).toFixed(5)) } : null);
  const report = {
    contracts: { all: new Set(obs.map((o) => o.ticker)).size, train: new Set(train.map((o) => o.ticker)).size, test: new Set(test.map((o) => o.ticker)).size },
    windows: { test: new Set(test.map((o) => o.closeMs)).size },
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
      /** NOT executable-verified: rows without recorded depth are assumed to show exactly 1 contract. Context only, never used by the verdict. */
      sensitivityDepthAssumed1: takerReplay(test, (o) => o.p, MAX_ORDER_COST_USD, { assumeDepth: 1 }),
    },
  };
  return { ...report, verdict: verdict(report) };
}

export type ValidationReport = ReturnType<typeof validateOne>;
/** One independent report and verdict per model version; versions are never pooled. */
export function validate(obs: Obs[], opts: { trainFrac?: number; purgeMs?: number } = {}): Record<string, ValidationReport> {
  const out: Record<string, ValidationReport> = {};
  for (const m of [...new Set(obs.map((o) => o.model))].sort()) out[m] = validateOne(obs.filter((o) => o.model === m), opts);
  return out;
}

/** Review-worthiness only. Never flips the release gate. */
export function verdict(r: {
  contracts: { test: number };
  test: { model: { brier: number } | null; marketMid: { brier: number } | null };
  afterCostTaker: { model: { trades: number; windows: number; meanPerTrade: number | null; clusteredSe: number | null } };
}) {
  const reasons: string[] = [];
  if (r.contracts.test < 500) reasons.push(`only ${r.contracts.test} test contracts (< 500)`);
  if (!r.test.model || !r.test.marketMid || r.test.model.brier >= r.test.marketMid.brier) reasons.push("model does not beat the Kalshi mid on Brier");
  const t = r.afterCostTaker.model;
  if (t.trades < 100 || t.windows < 50 || t.clusteredSe == null || t.meanPerTrade == null || t.meanPerTrade - 2 * t.clusteredSe <= 0)
    reasons.push("after-cost executable taker P/L not positive at 2 clustered standard errors (≥100 trades, ≥50 windows)");
  return { worthHumanReview: reasons.length === 0, reasons, releaseGateUnchanged: true as const };
}
