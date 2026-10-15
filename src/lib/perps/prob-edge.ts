/**
 * Two forecasting jobs. Neither score is a win probability.
 * Binary: P(YES settlement) vs the market price, scored only when outcomes exist.
 * Perps: P(target before stop | filled). Until that sample exists the state is UNKNOWN.
 * Break-even win rate is a cost identity, not an estimate of P.
 */
export type Outcome = { p: number; y: 0 | 1 };

export function brier(rows: Outcome[]): number | null {
  if (!rows.length) return null;
  if (rows.some((r) => !(r.p >= 0 && r.p <= 1) || (r.y !== 0 && r.y !== 1))) return null;
  return rows.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / rows.length;
}

export function logLoss(rows: Outcome[]): number | null {
  if (!rows.length) return null;
  const eps = 1e-6;
  if (rows.some((r) => !(r.p >= 0 && r.p <= 1) || (r.y !== 0 && r.y !== 1))) return null;
  return rows.reduce((s, r) => s + -(r.y * Math.log(Math.min(1 - eps, Math.max(eps, r.p))) + (1 - r.y) * Math.log(Math.min(1 - eps, Math.max(eps, 1 - r.p)))), 0) / rows.length;
}

export type EdgeReport = {
  task: "kalshi_binary_yes" | "kalshi_perps_target_before_stop";
  modelProbability: "UNKNOWN";
  breakEvenWinRate: number | null;
  brier: number | null;
  logLoss: number | null;
  n: number;
  note: string;
};

export function edgeReport(task: EdgeReport["task"], breakEven: number | null, outcomes: Outcome[]): EdgeReport {
  return {
    task,
    modelProbability: "UNKNOWN",
    breakEvenWinRate: breakEven,
    brier: brier(outcomes),
    logLoss: logLoss(outcomes),
    n: outcomes.length,
    note: outcomes.length ? "scores use only the supplied outcomes" : "no matched outcomes; probability stays UNKNOWN",
  };
}
