/**
 * The #124 protocol, made strict: walk forward week by week, fit only on the past, score only the future,
 * after fees, and keep nothing with fewer than 200 trades or a 95% interval that touches zero.
 *
 * Prediction (15-minute up/down): the strike is set at the window's open, so "up" = next bar closes above this
 * close. Assumed fill: taker at 51¢ (50¢ fair + 1¢ half spread) with Kalshi's quadratic fee 0.07·P·(1−P),
 * rounded up per order. The fill assumption is checked against real fills by scripts/fills-vs-51.ts.
 * Perpetuals are NOT scored here: a one-bar hold with a flat fee is not how they trade. They are tested with
 * Sameer's full rules (bracket, partial, trail, 8% stop size, day and account stops, fees, funding) in
 * perps-backtest.ts.
 */
import { FEATURES, cacheOf, toArray, vectorAt, type NewsHistory, type Vector } from "./features";
import { fitLogistic, predict, type Model } from "./model";
import type { Bar } from "./ta";

export type Sample = { t: number; asset: string; x: number[]; y: 0 | 1; ret: number };

export const PROTOCOL = Object.freeze({
  minTrades: 200,
  minTrainDays: 21,
  foldDays: 7,
  predPrice: 0.51,
  predFeeRate: 0.07,
  contractsPerOrder: 5,
  minFoldsPositive: 0.6,
  ridge: 5,
  edgeCuts: [0, 0.005, 0.01, 0.02, 0.03, 0.05, 0.08] as number[],
});

const BAR = 15 * 60_000;

export function samplesFor(asset: string, bars: Bar[], releases: number[] = [], hist: NewsHistory = {}): Sample[] {
  const s = cacheOf(bars);
  const out: Sample[] = [];
  for (let i = 0; i + 1 < bars.length; i++) {
    if (bars[i + 1].t !== bars[i].t + BAR) continue;
    const v = vectorAt(s, i, releases, undefined, hist);
    if (!v) continue;
    out.push({ t: bars[i].t + BAR, asset, x: toArray(v), y: bars[i + 1].c > bars[i].c ? 1 : 0, ret: (bars[i + 1].c - bars[i].c) / bars[i].c });
  }
  return out;
}

/** Fee per contract on a Kalshi order of `count` at `price` (quadratic, rounded up to the cent per order). */
export function kalshiFeePer(price: number, count = PROTOCOL.contractsPerOrder, rate = PROTOCOL.predFeeRate): number {
  return Math.ceil(rate * count * price * (1 - price) * 100 - 1e-9) / 100 / count;
}

export type Trade = { t: number; asset: string; side: 1 | -1; p: number; pnl: number; fold: number };

export function predTrade(p: number, y: 0 | 1, cut: number): { side: 1 | -1; pnl: number } | null {
  const side: 1 | -1 = p >= 0.5 ? 1 : -1;
  const pSide = side === 1 ? p : 1 - p;
  const price = PROTOCOL.predPrice;
  const fee = kalshiFeePer(price);
  if (pSide - price - fee < cut) return null;
  const win = (side === 1 && y === 1) || (side === -1 && y === 0);
  return { side, pnl: (win ? 1 : 0) - price - fee };
}

/** Mean and a 95% interval with errors clustered by bar time (the five coins move together). */
export function clusteredMean(trades: { t: number; pnl: number }[]): { mean: number; lo: number; hi: number } {
  const n = trades.length;
  if (!n) return { mean: 0, lo: 0, hi: 0 };
  const mean = trades.reduce((a, x) => a + x.pnl, 0) / n;
  const by = new Map<number, number>();
  for (const x of trades) by.set(x.t, (by.get(x.t) ?? 0) + (x.pnl - mean));
  let v = 0;
  for (const s of by.values()) v += s * s;
  const se = Math.sqrt(v) / n;
  return { mean, lo: mean - 1.96 * se, hi: mean + 1.96 * se };
}

/** A perps verdict built from the rules backtest (scripts/signal-perps.ts), in the same shape. */
export function perpReport(rows: { trades: number; winRate: number; avgR: number; returnPct: number; halted: boolean; asset: string }[], why: string): Report {
  const n = rows.reduce((a, r) => a + r.trades, 0);
  const byAsset: Report["byAsset"] = {};
  for (const r of rows) byAsset[r.asset] = { trades: r.trades, winRate: r.winRate, meanPnl: r.avgR };
  return {
    product: "perp", trades: n, winRate: n ? rows.reduce((a, r) => a + r.winRate * r.trades, 0) / n : 0, meanPnl: n ? rows.reduce((a, r) => a + r.avgR * r.trades, 0) / n : 0,
    ci95: [0, 0], totalPnl: rows.reduce((a, r) => a + r.returnPct, 0), foldsPositive: rows.filter((r) => r.returnPct > 0).length, folds: rows.length,
    brierModel: 0, brierBase: 0, byAsset, kept: false, why,
  };
}

export type Report = {
  product: "prediction" | "perp";
  trades: number;
  winRate: number;
  meanPnl: number;
  ci95: [number, number];
  totalPnl: number;
  foldsPositive: number;
  folds: number;
  brierModel: number;
  brierBase: number;
  byAsset: Record<string, { trades: number; winRate: number; meanPnl: number }>;
  kept: boolean;
  why: string;
};

function summarize(product: Report["product"], trades: Trade[], folds: number, brierModel: number, brierBase: number): Report {
  const ci = clusteredMean(trades);
  const wins = trades.filter((t) => t.pnl > 0).length;
  const perFold = new Map<number, number>();
  for (const t of trades) perFold.set(t.fold, (perFold.get(t.fold) ?? 0) + t.pnl);
  const foldsPos = [...perFold.values()].filter((x) => x > 0).length;
  const byAsset: Report["byAsset"] = {};
  for (const t of trades) {
    const a = (byAsset[t.asset] ??= { trades: 0, winRate: 0, meanPnl: 0 });
    a.trades += 1;
    a.winRate += t.pnl > 0 ? 1 : 0;
    a.meanPnl += t.pnl;
  }
  for (const a of Object.values(byAsset)) {
    a.winRate = a.winRate / a.trades;
    a.meanPnl = a.meanPnl / a.trades;
  }
  const foldShare = perFold.size ? foldsPos / perFold.size : 0;
  const reasons: string[] = [];
  if (trades.length < PROTOCOL.minTrades) reasons.push(`${trades.length} trades < ${PROTOCOL.minTrades}`);
  if (!(ci.lo > 0)) reasons.push(`95% interval low ${ci.lo.toFixed(4)} ≤ 0 after fees`);
  if (!(brierModel < brierBase)) reasons.push(`Brier ${brierModel.toFixed(5)} not better than coin-flip base ${brierBase.toFixed(5)}`);
  if (foldShare < PROTOCOL.minFoldsPositive) reasons.push(`only ${(foldShare * 100).toFixed(0)}% of weeks positive`);
  return {
    product, trades: trades.length, winRate: trades.length ? wins / trades.length : 0, meanPnl: ci.mean, ci95: [ci.lo, ci.hi],
    totalPnl: trades.reduce((a, t) => a + t.pnl, 0), foldsPositive: foldsPos, folds, brierModel, brierBase, byAsset,
    kept: reasons.length === 0, why: reasons.length ? reasons.join("; ") : "passed: ≥200 trades, positive after fees with 95% confidence, beats base, most weeks positive",
  };
}

/** Pick the entry cut on TRAINING data only (no peeking at the test week). */
function chooseCut(train: Sample[], probs: number[]): number {
  let best = { cut: PROTOCOL.edgeCuts[PROTOCOL.edgeCuts.length - 1], pnl: -Infinity };
  const minN = Math.max(50, Math.floor(train.length * 0.01));
  for (const cut of PROTOCOL.edgeCuts) {
    let pnl = 0;
    let n = 0;
    for (let i = 0; i < train.length; i++) {
      const tr = predTrade(probs[i], train[i].y, cut);
      if (tr) { pnl += tr.pnl; n++; }
    }
    if (n >= minN && pnl / n > best.pnl) best = { cut, pnl: pnl / n };
  }
  return best.cut;
}

export function walkForward(samples: Sample[]) {
  const all = [...samples].sort((a, b) => a.t - b.t);
  const out = { prediction: [] as Trade[], oos: [] as { p: number; y: number }[], folds: 0, cuts: [] as { fold: number; pred: number }[] };
  if (!all.length) return out;
  const day = 86_400_000;
  const t0 = all[0].t;
  const tEnd = all[all.length - 1].t;
  let fold = 0;
  for (let start = t0 + PROTOCOL.minTrainDays * day; start < tEnd; start += PROTOCOL.foldDays * day) {
    const end = start + PROTOCOL.foldDays * day;
    const train = all.filter((s) => s.t < start - BAR); // one-bar purge: the last training label ends before the test starts
    const test = all.filter((s) => s.t >= start && s.t < end);
    if (train.length < 500 || !test.length) continue;
    const m = fitLogistic(train.map((s) => s.x), train.map((s) => s.y), PROTOCOL.ridge, 10);
    const trainP = train.map((s) => predict(m, s.x));
    const cutPred = chooseCut(train, trainP);
    out.cuts.push({ fold, pred: cutPred });
    for (const s of test) {
      const p = predict(m, s.x);
      out.oos.push({ p, y: s.y });
      const a = predTrade(p, s.y, cutPred);
      if (a) out.prediction.push({ t: s.t, asset: s.asset, side: a.side, p, pnl: a.pnl, fold });
    }
    fold++;
  }
  out.folds = fold;
  return out;
}

export function runProtocol(samples: Sample[]) {
  const wf = walkForward(samples);
  const brier = wf.oos.reduce((a, o) => a + (o.p - o.y) ** 2, 0) / Math.max(1, wf.oos.length);
  const base = wf.oos.reduce((a, o) => a + (0.5 - o.y) ** 2, 0) / Math.max(1, wf.oos.length);
  return {
    prediction: summarize("prediction", wf.prediction, wf.folds, brier, base),
    trades: wf.prediction,
    folds: wf.folds,
    oosRows: wf.oos.length,
    cuts: wf.cuts,
    reliability: reliabilityBins(wf.oos),
  };
}

export function reliabilityBins(oos: { p: number; y: number }[], edges = [0, 0.45, 0.48, 0.5, 0.52, 0.55, 1]) {
  const out: { from: number; to: number; n: number; meanP: number; hitRate: number }[] = [];
  for (let k = 0; k + 1 < edges.length; k++) {
    const rows = oos.filter((o) => o.p >= edges[k] && o.p < edges[k + 1]);
    out.push({ from: edges[k], to: edges[k + 1], n: rows.length, meanP: rows.reduce((a, o) => a + o.p, 0) / Math.max(1, rows.length), hitRate: rows.reduce((a, o) => a + o.y, 0) / Math.max(1, rows.length) });
  }
  return out;
}

/** The final model: fit on everything, carrying the out-of-sample verdicts that decide whether it may trade. */
export function finalModel(samples: Sample[], version: string): Model {
  const all = [...samples].sort((a, b) => a.t - b.t);
  const m = fitLogistic(all.map((s) => s.x), all.map((s) => s.y), PROTOCOL.ridge, 25);
  return { version, features: FEATURES, bias: m.bias, weights: m.weights, ridge: PROTOCOL.ridge, trainedOn: { n: all.length, from: new Date(all[0]?.t ?? 0).toISOString(), to: new Date(all[all.length - 1]?.t ?? 0).toISOString() } };
}

export type { Vector };
