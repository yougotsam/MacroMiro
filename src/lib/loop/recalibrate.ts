/**
 * Verification-rot recalibration (PDF): compare what the checker/gate APPROVED vs what actually happened.
 * positive = gate approved; good = realized after-cost P&L > 0. Precision = approved that were good;
 * recall = good ones the gate approved. Falling precision over time = the checker is rotting.
 */
export type GateOutcome = { at: string; approved: boolean; netUsd: number | null };
export function precisionRecall(rows: GateOutcome[]) {
  const r = rows.filter((x) => x.netUsd != null);
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (const x of r) { const good = (x.netUsd as number) > 0; if (x.approved && good) tp++; else if (x.approved) fp++; else if (good) fn++; else tn++; }
  return { n: r.length, tp, fp, fn, tn, precision: tp + fp ? +(tp / (tp + fp)).toFixed(4) : null, recall: tp + fn ? +(tp / (tp + fn)).toFixed(4) : null,
    approvedNetUsd: +r.filter((x) => x.approved).reduce((a, x) => a + (x.netUsd as number), 0).toFixed(2), rejectedNetUsd: +r.filter((x) => !x.approved).reduce((a, x) => a + (x.netUsd as number), 0).toFixed(2) };
}
/** Same metrics per calendar week so drift is visible. */
export function byWeek(rows: GateOutcome[]) {
  const g = new Map<string, GateOutcome[]>();
  for (const x of rows) { const d = new Date(x.at); const k = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay())).toISOString().slice(0, 10); g.set(k, [...(g.get(k) ?? []), x]); }
  return [...g.entries()].sort().map(([week, xs]) => ({ week, ...precisionRecall(xs) }));
}
