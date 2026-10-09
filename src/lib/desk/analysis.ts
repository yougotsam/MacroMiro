/**
 * Replay + live-shadow analysis (round 3, task 7). Report-only; nothing here touches the order path.
 * Model vs Kalshi's implied probability (mid of the executable YES bid/ask) and simulated net P/L at EXECUTABLE prices
 * (the displayed ask, size ≤ displayed depth, the event's actual fee multiplier), reported separately by market
 * (series), strategy and time-to-expiry bucket, with uncertainty clustered by close window (all coins closing in the
 * same 15-minute window move together, so a window is one cluster).
 */
import { reportBucket, TIMING_POLICIES, bucketFor } from "./approval";
import { brier, clusteredSe, settlementCluster, fitRecalibration, purgedSplit, takerTrades, type Obs, type ReplayTrade } from "./calibration";
import { APPROVAL_CUSHION, MAX_ORDER_COST_USD, PRICE_MAX, PRICE_MIN } from "./config";
import { orderFee } from "./fees";
import { minPriceFor } from "./guard";

const r4 = (x: number | null) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(4)));

/** deterministic PRNG for the cluster bootstrap */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** Brier skill vs the Kalshi mid with a 95 % cluster-bootstrap interval (resampling close windows). */
export function skillVsMarket(obs: Obs[], prob: (o: Obs) => number = (o) => o.p, reps = 1000, seed = 7) {
  const n = obs.length;
  const windows = [...new Set(obs.map((o) => settlementCluster(o.closeMs, o.series)))];
  if (n < 2) return { n, contracts: new Set(obs.map((o) => o.ticker)).size, windows: windows.length, brierModel: null, brierMarket: null, bss: null, ci95: null };
  const bm = brier(obs.map(prob), obs.map((o) => o.y));
  const bk = brier(obs.map((o) => o.mid), obs.map((o) => o.y));
  const bss = bk > 0 ? 1 - bm / bk : null;
  let ci95: [number, number] | null = null;
  if (windows.length >= 5 && bk > 0) {
    const by = new Map<number, Obs[]>();
    for (const o of obs) { const c = settlementCluster(o.closeMs, o.series); by.set(c, [...(by.get(c) ?? []), o]); }
    const r = rng(seed);
    const vals: number[] = [];
    for (let i = 0; i < reps; i += 1) {
      const pick: Obs[] = [];
      for (let k = 0; k < windows.length; k += 1) pick.push(...by.get(windows[Math.floor(r() * windows.length)])!);
      const m = brier(pick.map(prob), pick.map((o) => o.y));
      const k2 = brier(pick.map((o) => o.mid), pick.map((o) => o.y));
      if (k2 > 0) vals.push(1 - m / k2);
    }
    vals.sort((a, b) => a - b);
    ci95 = [r4(vals[Math.floor(0.025 * vals.length)])!, r4(vals[Math.floor(0.975 * vals.length) - 1])!];
  }
  return { n, contracts: new Set(obs.map((o) => o.ticker)).size, windows: windows.length, brierModel: r4(bm), brierMarket: r4(bk), bss: r4(bss), ci95 };
}

export function groupBy<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}

/** Calibration by market and by expiry bucket. */
export function calibrationTables(obs: Obs[], prob?: (o: Obs) => number) {
  const out: Record<string, ReturnType<typeof skillVsMarket>> = { ALL: skillVsMarket(obs, prob) };
  for (const [k, v] of groupBy(obs, (o) => `market=${o.series}`)) out[k] = skillVsMarket(v, prob);
  for (const [k, v] of groupBy(obs, (o) => `bucket=${reportBucket(o.tte)}`)) out[k] = skillVsMarket(v, prob);
  return out;
}

export type Trade = ReplayTrade & { series: string; bucket: string; strategy: string };

export function pnlSummary(trades: Trade[]) {
  const n = trades.length;
  const total = trades.reduce((a, t) => a + t.pnl, 0);
  const mean = n ? total / n : null;
  const cse = clusteredSe(trades.map((t) => ({ cluster: settlementCluster(t.closeMs, t.ticker), pnl: t.pnl })));
  return {
    trades: n, windows: new Set(trades.map((t) => settlementCluster(t.closeMs, t.ticker))).size, total: r4(total), meanPerTrade: r4(mean), clusteredSe: r4(cse),
    ci95: mean != null && cse != null ? [r4(mean - 1.96 * cse), r4(mean + 1.96 * cse)] : null,
  };
}

/** P/L tables by strategy × market × bucket (plus marginal rows). */
export function pnlTables(trades: Trade[]) {
  const out: Record<string, ReturnType<typeof pnlSummary>> = {};
  for (const [s, ts] of groupBy(trades, (t) => t.strategy)) {
    out[`${s} | ALL | ALL`] = pnlSummary(ts);
    for (const [k, v] of groupBy(ts, (t) => `${s} | ${t.series} | ALL`)) out[k] = pnlSummary(v);
    for (const [k, v] of groupBy(ts, (t) => `${s} | ALL | ${t.bucket}`)) out[k] = pnlSummary(v);
    for (const [k, v] of groupBy(ts, (t) => `${s} | ${t.series} | ${t.bucket}`)) out[k] = pnlSummary(v);
  }
  return out;
}

const tag = (strategy: string, xs: ReplayTrade[]): Trade[] => xs.map((t) => ({ ...t, strategy, series: t.ticker.split("-")[0], bucket: reportBucket(t.tte) }));

/** Strategy 1 — the live settlement gate, taker only (what the desk would have sent with no release lock). */
export function gateTaker(obs: Obs[]) {
  const r = takerTrades(obs, (o) => o.p);
  return { trades: tag("settlement_gate_taker", r.trades), skipped: r.skipped };
}

/**
 * Strategy 2 — the round-3 approval rule, out of sample: Platt calibrator fitted on TRAIN, applied to TEST; a trade needs
 * the gate's candidate AND conservative EV = P_cal(side) − cushion − ask − fee/contract − bucket extra > 0.
 */
export function approvalRuleOos(train: Obs[], test: Obs[], cushion = APPROVAL_CUSHION) {
  if (train.length < 30) return { trades: [] as Trade[], skipped: { reason: `only ${train.length} train observations (<30): no calibrator` }, calibrator: null };
  const fit = fitRecalibration(train.map((o) => o.p), train.map((o) => o.y));
  const pol = TIMING_POLICIES.current;
  const r = takerTrades(test, (o) => fit.apply(o.p), MAX_ORDER_COST_USD, {
    accept: (o, c) => {
      const b = bucketFor(pol, o.tte);
      if (!b || !b.allow) return false;
      const pc = fit.apply(o.p);
      const pSide = c.side === "yes" ? pc : 1 - pc;
      return pSide - cushion - c.price - c.feePer - b.extraEdge > 0;
    },
  });
  return { trades: tag("approval_rule_oos", r.trades), skipped: r.skipped, calibrator: { a: r4(fit.a), b: r4(fit.b), trainObs: train.length } };
}

/**
 * Strategy 3 — research only: the sniper confluence signal (Coinbase bars) as a taker entry, YES for long / NO for short,
 * at the displayed ask within displayed depth, after the event's fee. It has no probability, so it is NOT approvable;
 * it is reported to see whether the indicators carry information at executable prices.
 */
export function sniperTaker(obs: Obs[], signal: (o: Obs) => "long" | "short" | null) {
  const trades: ReplayTrade[] = [];
  const skipped = { noSignal: 0, feeUnknown: 0, depthUnknown: 0, band: 0, size: 0, alreadyEntered: 0 };
  const entered = new Set<string>();
  for (const o of [...obs].sort((a, b) => a.closeMs - b.closeMs || b.tte - a.tte)) {
    if (entered.has(o.ticker)) { skipped.alreadyEntered += 1; continue; }
    const s = signal(o);
    if (!s) { skipped.noSignal += 1; continue; }
    if (o.feeMultiplier == null) { skipped.feeUnknown += 1; continue; }
    const side = s === "long" ? "yes" : "no";
    const price = side === "yes" ? o.yesAsk : Math.round((1 - o.yesBid) * 10_000) / 10_000;
    const depth = side === "yes" ? o.noBidSize : o.yesBidSize;
    if (depth == null) { skipped.depthUnknown += 1; continue; }
    if (price < Math.max(PRICE_MIN, minPriceFor(o.tte)) || price > PRICE_MAX) { skipped.band += 1; continue; }
    const fee = { feeType: "quadratic", multiplier: o.feeMultiplier };
    let count = Math.min(Math.floor(depth), Math.floor(MAX_ORDER_COST_USD / price));
    while (count > 0 && count * price + orderFee(count, price, false, fee) > MAX_ORDER_COST_USD + 1e-9) count -= 1;
    if (count < 1) { skipped.size += 1; continue; }
    const f = orderFee(count, price, false, fee);
    const win = side === "yes" ? o.y === 1 : o.y === 0;
    trades.push({ ticker: o.ticker, closeMs: o.closeMs, side, price, count, fee: f, tte: o.tte, pnl: count * ((win ? 1 : 0) - price) - f });
    entered.add(o.ticker);
  }
  return { trades: tag("sniper_confluence_research", trades), skipped };
}

export { purgedSplit };
