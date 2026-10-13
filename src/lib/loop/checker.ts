/**
 * INDEPENDENT CHECKER (strategy-level gate). Blind to the maker: it accepts ONLY a trade log of
 * { t, netUsd, oos } rows plus optional trial count. It never receives reasoning, prompts, setups or scores —
 * `blindTrades` strips every other field so a caller cannot leak them by accident.
 * Deterministic gates (all must pass): OOS trades ≥ 200, after-cost mean > 0, Newey–West t > 2,
 * max drawdown ≤ limit, per-trade Sharpe ≥ floor. Also reports PSR/deflated-Sharpe (informational, n_trials aware).
 * Verdicts follow the Monte-Neo vocabulary: PASS | NEEDS_MORE_EVIDENCE | REJECT.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { loopDir, P } from "./paths";

export type BlindTrade = { t: number; netUsd: number; oos: boolean };
export type GateCfg = { minOosTrades: number; minNwT: number; maxDrawdownPct: number; minSharpePerTrade: number; startEquityUsd: number };
export const DEFAULT_GATE: GateCfg = { minOosTrades: 200, minNwT: 2, maxDrawdownPct: 50, minSharpePerTrade: 0.05, startEquityUsd: 500 };
export type Verdict = "PASS" | "NEEDS_MORE_EVIDENCE" | "REJECT";

export function blindTrades(rows: Array<Record<string, unknown>>): BlindTrade[] {
  return rows.map((r) => ({ t: Number(r.t), netUsd: Number(r.netUsd ?? r.net), oos: r.oos !== false })).filter((r) => Number.isFinite(r.t) && Number.isFinite(r.netUsd));
}

const mean = (x: number[]) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0);
/** Bartlett-kernel Newey–West t-stat of the mean; automatic lag floor(4 (T/100)^(2/9)). */
export function neweyWestT(x: number[], lag?: number) {
  const T = x.length; if (T < 3) return { t: null as number | null, lag: 0, se: null as number | null };
  const L = lag ?? Math.floor(4 * Math.pow(T / 100, 2 / 9));
  const m = mean(x), d = x.map((v) => v - m);
  let lrv = d.reduce((a, v) => a + v * v, 0) / T;
  for (let k = 1; k <= Math.min(L, T - 1); k++) {
    let g = 0; for (let i = k; i < T; i++) g += d[i] * d[i - k];
    lrv += 2 * (1 - k / (L + 1)) * (g / T);
  }
  if (!(lrv > 0)) return { t: null, lag: L, se: null };
  const se = Math.sqrt(lrv / T);
  return { t: m / se, lag: L, se };
}
export function maxDrawdownPct(nets: number[], start: number) {
  let eq = start, peak = start, dd = 0;
  for (const n of nets) { eq += n; peak = Math.max(peak, eq); dd = Math.max(dd, peak > 0 ? (peak - eq) / peak : 1); }
  return dd * 100;
}
const ncdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2));
function erf(x: number) { const s = Math.sign(x); x = Math.abs(x); const t = 1 / (1 + 0.3275911 * x); const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return s * y; }
/** Probabilistic Sharpe vs benchmark SR*, with the expected-max SR for n_trials as the deflated benchmark (Bailey & López de Prado). */
export function psr(x: number[], nTrials = 1) {
  const T = x.length; if (T < 3) return { psr: null as number | null, dsr: null as number | null, sr: null as number | null };
  const m = mean(x), sd = Math.sqrt(x.reduce((a, v) => a + (v - m) ** 2, 0) / (T - 1)); if (!(sd > 0)) return { psr: null, dsr: null, sr: null };
  const sr = m / sd, z3 = x.reduce((a, v) => a + ((v - m) / sd) ** 3, 0) / T, z4 = x.reduce((a, v) => a + ((v - m) / sd) ** 4, 0) / T;
  const den = Math.sqrt(Math.max(1e-12, 1 - z3 * sr + ((z4 - 1) / 4) * sr * sr));
  const p = (bench: number) => ncdf(((sr - bench) * Math.sqrt(T - 1)) / den);
  const g = 0.5772156649, N = Math.max(1, nTrials);
  const inv = (q: number) => { let lo = -10, hi = 10; for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (ncdf(mid) < q) lo = mid; else hi = mid; } return lo; };
  const srStar = N > 1 ? (1 / Math.sqrt(T - 1)) * ((1 - g) * inv(1 - 1 / N) + g * inv(1 - 1 / (N * Math.E))) : 0;
  return { psr: +p(0).toFixed(4), dsr: +p(srStar).toFixed(4), sr: +sr.toFixed(4) };
}

export type GateReport = {
  verdict: Verdict; pass: boolean; checks: Record<string, { pass: boolean; value: number | null; need: string }>;
  stats: { oosTrades: number; meanUsd: number; nwT: number | null; nwLag: number; maxDdPct: number; sharpePerTrade: number | null; psr: number | null; dsr: number | null; nTrials: number };
  cfg: GateCfg; at: string;
};
export function strategyGate(trades: BlindTrade[], cfg: GateCfg = DEFAULT_GATE, nTrials = 1): GateReport {
  const oos = trades.filter((t) => t.oos).sort((a, b) => a.t - b.t).map((t) => t.netUsd);
  const m = mean(oos), nw = neweyWestT(oos), dd = maxDrawdownPct(oos, cfg.startEquityUsd), ps = psr(oos, nTrials);
  const checks = {
    oos_trades: { pass: oos.length >= cfg.minOosTrades, value: oos.length, need: `≥ ${cfg.minOosTrades}` },
    after_cost_mean: { pass: oos.length > 0 && m > 0, value: +m.toFixed(4), need: "> 0" },
    newey_west_t: { pass: nw.t != null && nw.t > cfg.minNwT, value: nw.t == null ? null : +nw.t.toFixed(3), need: `> ${cfg.minNwT}` },
    max_drawdown: { pass: oos.length > 0 && dd <= cfg.maxDrawdownPct, value: +dd.toFixed(2), need: `≤ ${cfg.maxDrawdownPct}%` },
    sharpe: { pass: ps.sr != null && ps.sr >= cfg.minSharpePerTrade, value: ps.sr, need: `≥ ${cfg.minSharpePerTrade} per trade` },
  };
  const pass = Object.values(checks).every((c) => c.pass);
  // too few trades but nothing else broken → more evidence; a negative mean or broken DD → reject
  const verdict: Verdict = pass ? "PASS" : (!checks.after_cost_mean.pass && oos.length >= 30) || (!checks.max_drawdown.pass && oos.length > 0) ? "REJECT" : "NEEDS_MORE_EVIDENCE";
  return { verdict, pass, checks, stats: { oosTrades: oos.length, meanUsd: +m.toFixed(4), nwT: checks.newey_west_t.value, nwLag: nw.lag, maxDdPct: +dd.toFixed(2), sharpePerTrade: ps.sr, psr: ps.psr, dsr: ps.dsr, nTrials }, cfg, at: new Date().toISOString() };
}

/** Rejection-rate tracker: every decision is logged; the rate is the share of REJECT/NEEDS_MORE_EVIDENCE. */
export function logGateDecision(strategy: string, r: GateReport, extra: Record<string, unknown> = {}) {
  mkdirSync(loopDir(), { recursive: true });
  appendFileSync(P.gateLog(), JSON.stringify({ at: r.at, strategy, verdict: r.verdict, pass: r.pass, stats: r.stats, ...extra }) + "\n");
}
export function rejectionRate(rows: { verdict: Verdict }[]) {
  const n = rows.length; const rej = rows.filter((r) => r.verdict !== "PASS").length;
  return { decisions: n, rejected: rej, rate: n ? +(rej / n).toFixed(4) : null };
}

/**
 * The ONLY path by which CALIBRATED_MODEL_APPROVED may be proposed true: a PASS gate report. This returns a proposal
 * object for the owner; it never edits config.ts (a const false) and never flips a switch.
 */
export function proposeCalibratedApproval(r: GateReport | null) {
  if (!r || r.verdict !== "PASS") return { allowed: false as const, why: `strategy gate verdict ${r?.verdict ?? "missing"}: CALIBRATED_MODEL_APPROVED must stay false` };
  return { allowed: true as const, why: "gate PASS — owner may review a proposal; nothing is changed automatically", proposal: { flag: "CALIBRATED_MODEL_APPROVED", proposed: true, evidence: r.stats, at: r.at } };
}

/** Export bundle for Verdict (external grader): trade log only + gate report + method notes. No reasoning. */
export function verdictBundle(strategy: string, trades: BlindTrade[], r: GateReport, provenance: string) {
  return { schema: "macromiro-verdict-bundle/1", strategy, provenance, generatedAt: new Date().toISOString(), trades, gate: r,
    method: { newey_west: "Bartlett kernel, lag floor(4 (T/100)^(2/9))", psr_dsr: "Bailey & López de Prado; DSR benchmark = expected max SR over nTrials", blind: "maker reasoning, prompts, setups and scores are excluded" } };
}
