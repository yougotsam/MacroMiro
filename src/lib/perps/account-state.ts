/**
 * Parse the AUTHENTICATED Kalshi margin balance response. It must come from
 * GET /margin/balance?compute_available_balance=true; without that flag
 * Kalshi returns zero available balance even when capital is available.
 *
 * This module NEVER grants trading permission and NEVER places orders.
 */
export type MarginAccount = {
  subaccount: number;
  mode: "cross";
  equityUsd: number;
  availableUsd: number;
  initialMarginUsd: number;
  maintenanceMarginUsd: number;
  restingOrderMarginUsd: number;
  positionValueUsd: number;
};
export type AccountRead = { ok: true; account: MarginAccount } | { ok: false; why: string };
function money(x: unknown): number | null {
  if ((typeof x !== "number" && typeof x !== "string") || x === "") return null;
  const v = Number(x);
  return Number.isFinite(v) && v >= 0 ? v : null;
}
export function parseMarginAccount(raw: unknown, subaccount = 0): AccountRead {
  const data = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!Array.isArray(data?.subaccount_balances)) return { ok: false, why: "venue subaccount balances missing" };
  const matches = data.subaccount_balances.filter((x): x is Record<string, unknown> =>
    x != null && typeof x === "object" && (x as { subaccount?: unknown }).subaccount === subaccount);
  if (matches.length !== 1) return { ok: false, why: "ambiguous or missing venue subaccount" };
  const v = matches[0];
  if (v.subaccount_type !== "cross") return { ok: false, why: "only cross-margin snapshot supported" };
  const e = money(v.account_equity), a = money(v.available_balance), im = money(v.initial_margin);
  const mm = money(v.maintenance_margin), ro = money(v.resting_orders_margin), pv = money(v.position_value);
  if (e === null || a === null || im === null || mm === null || ro === null || pv === null)
    return { ok: false, why: "missing or invalid equity, available balance or margin fields" };
  if (a > e + 0.0001) return { ok: false, why: "available collateral above account equity; review venue data" };
  return { ok: true, account: {
    subaccount, mode: "cross", equityUsd: e, availableUsd: a, initialMarginUsd: im,
    maintenanceMarginUsd: mm, restingOrderMarginUsd: ro, positionValueUsd: pv,
  } };
}

export type FillPnl = { fill_id: string; created_time: string; realized_pnl: string; fees: string };
/**
 * Diagnostic realized-fill subtotal ONLY. This is not an authoritative daily
 * loss limit: if history is paginated/truncated, funding/carry is absent, or
 * positions are still open, the equity-based drawdown differs. Do not use
 * this subtotal to authorize live entries.
 */
export function summarizeFillPnl(fills: FillPnl[], startMs: number, endMs: number) {
  if (!(endMs > startMs) || !Number.isFinite(startMs) || !Number.isFinite(endMs))
    return { ok: false as const, why: "invalid period" };
  const ids = new Set<string>();
  let realized = 0, fees = 0, count = 0;
  for (const f of fills) {
    const t = Date.parse(f.created_time);
    if (!f.fill_id || !Number.isFinite(t) || !Number.isFinite(Number(f.realized_pnl)) ||
      !Number.isFinite(Number(f.fees)) || Number(f.fees) < 0)
      return { ok: false as const, why: "invalid or incomplete fill history" };
    if (ids.has(f.fill_id)) continue;
    ids.add(f.fill_id);
    if (t < startMs || t >= endMs) continue;
    realized += Number(f.realized_pnl);
    fees += Number(f.fees);
    count++;
  }
  return { ok: true as const, count, realizedUsd: +realized.toFixed(6), feesUsd: +fees.toFixed(6),
    afterFillFeesUsd: +(realized - fees).toFixed(6),
    authoritativeDayLoss: false as const };
}
