/**
 * Pure summary of analysis-latest.json for the 200-window evaluation. No I/O, no orders, no approvals.
 * "credible improvement" for a named setup needs ≥ 30 contracts AND ≥ 30 independent clusters AND both its residual vs
 * the settlement model and its after-cost taker P/L per trade positive by > 2.73 clustered SE (Bonferroni for 8 setups).
 */
export const EVAL_WINDOWS = 200;
export const BONFERRONI_Z_8 = 2.73;
type Pnl = { trades: number; windows: number; total: number; meanPerTrade: number | null; clusteredSe: number | null; ci95: [number, number] | null };
type Cal = { n: number; contracts: number; windows: number; brierModel: number | null; brierMarket: number | null; bss: number | null; ci95: [number, number] | null };
type Setup = { contracts: number; windows: number; residualVsSettlementModel: { mean: number; clusteredSe: number | null } | null; takerAfterCost: Pnl; verdict: string };
type ModelSection = { observations?: number; contracts?: number; windows?: number; calibration?: Record<string, Cal>; pnl?: Record<string, Pnl>; namedSetups?: Record<string, Setup>; walkForward?: { folds: number; oosRows: number; scores?: Record<string, unknown> } };
export type Analysis = {
  generatedAt?: string;
  collector: { independentClosingWindows: { completed: number; remaining: number; etaAt: string }; independentClusters?: unknown; completeness?: unknown; uniqueMarkets?: unknown; repeatedScans?: unknown };
  liveShadow?: { byModel?: Record<string, ModelSection> };
  historical?: { byModel?: Record<string, ModelSection> };
};

export function credible(s: Setup) {
  const r = s.residualVsSettlementModel, p = s.takerAfterCost;
  if (s.contracts < 30 || s.windows < 30 || !r || r.clusteredSe == null || p.meanPerTrade == null || p.clusteredSe == null) return false;
  return r.mean - BONFERRONI_Z_8 * r.clusteredSe > 0 && p.meanPerTrade - BONFERRONI_Z_8 * p.clusteredSe > 0;
}

export function summarizeEvaluation(a: Analysis) {
  const done = a.collector.independentClosingWindows.completed;
  const label = done >= EVAL_WINDOWS ? "evaluation (200+ independent windows)" : "PRELIMINARY (fewer than 200 independent windows)";
  const models = Object.entries(a.liveShadow?.byModel ?? {}).sort((x, y) => (y[1].observations ?? 0) - (x[1].observations ?? 0));
  const [model, m] = models[0] ?? ["none", {} as ModelSection];
  const cal = m.calibration ?? {};
  const pnl = m.pnl ?? {};
  const timing = Object.fromEntries(["final-60s", "1-5m", "5-10m", ">10m"].map((b) => [b, {
    calibration: cal[`bucket=${b}`] ?? null,
    settlementTakerAfterCost: pnl[`settlement_gate_taker | ALL | ${b}`] ?? null,
  }]));
  const setups = Object.fromEntries(Object.entries(m.namedSetups ?? {}).map(([k, s]) => [k, { ...s, credibleImprovement: credible(s) }]));
  return {
    label,
    generatedAt: a.generatedAt ?? null,
    windows: { completed: done, target: EVAL_WINDOWS, remaining: a.collector.independentClosingWindows.remaining, etaAt: done >= EVAL_WINDOWS ? null : a.collector.independentClosingWindows.etaAt },
    clusters: a.collector.independentClusters ?? null,
    completeness: a.collector.completeness ?? null,
    model,
    settlementOnly: { vsKalshiImplied: cal.ALL ?? null, takerAfterCost: pnl["settlement_gate_taker | ALL | ALL"] ?? null, walkForward: m.walkForward ? { folds: m.walkForward.folds, oosRows: m.walkForward.oosRows, scores: m.walkForward.scores ?? null } : null },
    technicalConfluence: { setups, anyCredible: Object.values(setups).some((s) => s.credibleImprovement), rule: `≥30 contracts, ≥30 clusters, residual and after-cost P/L > ${BONFERRONI_Z_8} clustered SE` },
    timing,
    promotion: "none — reaching 200 windows promotes nothing; approval stays an owner decision",
  };
}
