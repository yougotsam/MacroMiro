/**
 * Walk-forward, chronological, leakage-free validation (Phase 1c/1e). Report-only.
 *
 * Folds are built on CLOSE WINDOWS (the 15-minute settlement time), never on rows: a window's contracts are all train
 * or all test. Each test fold uses parameters fitted ONLY on windows that closed at least `purgeMs` before the fold's
 * first window. Every probability source is scored on exactly the same out-of-sample rows.
 *
 * Probability sources:
 *   market_mid       Kalshi implied probability (YES mid) — the benchmark
 *   coin             0.5
 *   threshold_time   σ(a + b·ln(S/K)/√t)          (no volatility input)
 *   threshold_vol    σ(a + b·ln(S/K)/(σ√t))       (volatility-scaled distance)
 *   model_raw        the desk's settlement model p (as logged)
 *   model_wf_platt   Platt recalibration of p, refitted each fold
 *
 * The approval milestone does NOT need approved trades: it needs ≥ 200 completed independent windows of shadow data,
 * a walk-forward pass and THEN an owner decision. A calibrator file produced here is a CANDIDATE (approvedBy = null);
 * `loadCalibrator` refuses it until a person signs it. Nothing here writes calibrator.json.
 */
import { reportBucket } from "./approval";
import type { Calibrator } from "./approval";
import { brier, fitRecalibration, logLoss, takerTrades, type Obs } from "./calibration";
import { pnlSummary, skillVsMarket, type Trade } from "./analysis";

export const SOURCES = ["market_mid", "coin", "threshold_time", "threshold_vol", "model_raw", "model_wf_platt"] as const;
export type Source = (typeof SOURCES)[number];
export const MILESTONE_WINDOWS = 200;

const sigm = (x: number) => 1 / (1 + Math.exp(-x));
const clipX = (x: number) => Math.max(-8, Math.min(8, x));
/** one-feature logistic regression a + b·x via the Platt fitter (logit(σ(x)) = x) */
function fitLogit1(xs: number[], ys: number[]) {
  const f = fitRecalibration(xs.map((x) => sigm(clipX(x))), ys);
  return (x: number) => f.apply(sigm(clipX(x)));
}

export type Fold = { trainWindows: number; testWindows: number; testFrom: string; testTo: string };

export function walkForward(obs: Obs[], opts: { minTrainWindows?: number; stepWindows?: number; purgeMs?: number } = {}) {
  const minTrain = opts.minTrainWindows ?? 20, step = opts.stepWindows ?? 5, purge = opts.purgeMs ?? 30 * 60_000;
  const windows = [...new Set(obs.map((o) => o.closeMs))].sort((a, b) => a - b);
  const preds: Array<{ o: Obs; p: Record<Source, number | null> }> = [];
  const folds: Fold[] = [];
  for (let i = minTrain; i < windows.length; i += step) {
    const testW = new Set(windows.slice(i, i + step));
    const start = windows[i];
    const train = obs.filter((o) => o.closeMs <= start - purge);
    const test = obs.filter((o) => testW.has(o.closeMs));
    const trainW = new Set(train.map((o) => o.closeMs)).size;
    if (trainW < minTrain || !test.length) continue;
    // no leakage: everything fitted below sees only `train`
    const platt = fitRecalibration(train.map((o) => o.p), train.map((o) => o.y));
    const tt = train.filter((o) => o.dist != null);
    const tv = train.filter((o) => o.z != null);
    const fTime = tt.length >= 30 ? fitLogit1(tt.map((o) => o.dist! * 1000), tt.map((o) => o.y)) : null;
    const fVol = tv.length >= 30 ? fitLogit1(tv.map((o) => o.z!), tv.map((o) => o.y)) : null;
    for (const o of test) {
      preds.push({ o, p: {
        market_mid: o.mid, coin: 0.5,
        threshold_time: fTime && o.dist != null ? fTime(o.dist * 1000) : null,
        threshold_vol: fVol && o.z != null ? fVol(o.z) : null,
        model_raw: o.p, model_wf_platt: platt.apply(o.p),
      } });
    }
    folds.push({ trainWindows: trainW, testWindows: testW.size, testFrom: new Date(start).toISOString(), testTo: new Date(windows[Math.min(i + step, windows.length) - 1]).toISOString() });
  }
  return { windows: windows.length, folds, preds };
}

/** Score every source on the SAME rows (rows where every source has a prediction). */
export function scoreSources(preds: ReturnType<typeof walkForward>["preds"]) {
  const common = preds.filter((x) => SOURCES.every((s) => x.p[s] != null));
  const out: Record<string, unknown> = { rows: common.length, droppedForMissingBaselineInputs: preds.length - common.length };
  for (const s of SOURCES) {
    const ps = common.map((x) => x.p[s]!), ys = common.map((x) => x.o.y);
    const sk = skillVsMarket(common.map((x) => ({ ...x.o, p: x.p[s]! })));
    out[s] = common.length ? { brier: Number(brier(ps, ys).toFixed(5)), logLoss: Number(logLoss(ps, ys).toFixed(5)), skillVsMid: sk.bss, skillCi95: sk.ci95 } : null;
  }
  return out;
}

/** Executable after-cost P/L per source (YES and NO separately) on the walk-forward predictions. */
export function sourcePnl(preds: ReturnType<typeof walkForward>["preds"]) {
  const out: Record<string, unknown> = {};
  for (const s of SOURCES) {
    if (s === "market_mid") { out[s] = "benchmark (no edge by construction)"; continue; }
    const rows = preds.filter((x) => x.p[s] != null);
    const pm = new Map(rows.map((x) => [`${x.o.ticker}|${x.o.tteBucket}`, x.p[s]!]));
    const r = takerTrades(rows.map((x) => x.o), (o) => pm.get(`${o.ticker}|${o.tteBucket}`)!);
    const tr: Trade[] = r.trades.map((t) => ({ ...t, strategy: s, series: t.ticker.split("-")[0], bucket: reportBucket(t.tte) }));
    out[s] = { all: pnlSummary(tr), yes: pnlSummary(tr.filter((t) => t.side === "yes")), no: pnlSummary(tr.filter((t) => t.side === "no")), skipped: r.skipped };
  }
  return out;
}

/** Timing buckets evaluated (never activated): calibration of each source vs mid inside each bucket. */
export function timingBuckets(preds: ReturnType<typeof walkForward>["preds"]) {
  const out: Record<string, unknown> = {};
  for (const b of [">10m", "5-10m", "1-5m", "final-60s"]) {
    const rows = preds.filter((x) => reportBucket(x.o.tte) === b && x.p.model_wf_platt != null);
    out[b] = {
      model_raw: skillVsMarket(rows.map((x) => ({ ...x.o, p: x.p.model_raw! }))),
      model_wf_platt: skillVsMarket(rows.map((x) => ({ ...x.o, p: x.p.model_wf_platt! }))),
    };
  }
  return out;
}

export type MilestoneState = "collecting" | "evaluate" | "candidate_for_owner_review" | "not_ready_failed_walk_forward";
/**
 * Training/validation comes BEFORE approval. Approved trades are never an input (they are always 0 here by design).
 * collecting → evaluate at ≥ 200 completed independent windows → pass rule (fixed in advance): walk-forward Platt
 * skill vs mid > 0 with CI lower bound > 0 AND after-cost mean P/L CI lower bound > 0 → candidate for owner review.
 */
export function milestone(completedWindows: number, wf?: { skillCi95: [number, number] | null; pnlCi95: [number, number] | null }) {
  if (completedWindows < MILESTONE_WINDOWS) return { state: "collecting" as MilestoneState, completedWindows, need: MILESTONE_WINDOWS - completedWindows, approvedTradesRequired: 0 };
  if (!wf) return { state: "evaluate" as MilestoneState, completedWindows, need: 0, approvedTradesRequired: 0 };
  const pass = !!wf.skillCi95 && wf.skillCi95[0] > 0 && !!wf.pnlCi95 && wf.pnlCi95[0] > 0;
  return { state: (pass ? "candidate_for_owner_review" : "not_ready_failed_walk_forward") as MilestoneState, completedWindows, need: 0, approvedTradesRequired: 0 };
}

/** A calibrator CANDIDATE (never approved here). */
export function candidateCalibrator(obs: Obs[], model: string, oos: { contracts: number; windows: number; brierModel: number; brierMarket: number }): Calibrator {
  const f = fitRecalibration(obs.map((o) => o.p), obs.map((o) => o.y));
  const ts = obs.map((o) => o.closeMs).sort((a, b) => a - b);
  return {
    id: `cand-${model}-${new Date(ts[ts.length - 1] ?? 0).toISOString()}`, model, method: "platt", a: f.a, b: f.b,
    fittedOn: { contracts: new Set(obs.map((o) => o.ticker)).size, windows: new Set(ts).size, from: new Date(ts[0] ?? 0).toISOString(), to: new Date(ts[ts.length - 1] ?? 0).toISOString() },
    outOfSample: oos, approvedBy: null, approvedAt: null,
  };
}
