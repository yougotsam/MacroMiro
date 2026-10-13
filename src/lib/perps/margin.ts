/**
 * Perps margin and liquidation math, using only documented Kalshi fields:
 *  - market.leverage_estimates[notional] = 1 / margin_rate. The maintenance rate falls in steps as notional grows.
 *  - risk_parameters.initial_margin_multiplier[ticker]: initial = maintenance × multiplier (1.3 seen on 2026-10-12).
 *  - risk_parameters.liquidation_margin_ratio_threshold (1.0 seen): liquidated when equity ≤ maintenance × threshold.
 *    queue_entry_margin_ratio_threshold (0.91 seen) is where the position joins the liquidation queue.
 *  - Price is in dollars per contract, so P&L = qty × Δprice (shorts reversed) and notional = |qty| × price.
 * Kalshi's own wording: liquidation "can't guarantee your balance won't go negative" (kalshi.com/perpetuals/learn).
 * So a gap past the liquidation price CAN lose more than the margin posted. lossCanExceedMargin is always true.
 */
export type LeverageTable = Record<string, number>; // notional "1000" | "10000" | ... → leverage (1/margin rate)
export type MarginSpec = { leverage: LeverageTable; initialMultiplier: number; liqThreshold: number };

/** Maintenance margin rate for a notional, using the smallest documented bucket ≥ notional (conservative: higher buckets have lower leverage). */
export function maintenanceRate(spec: MarginSpec, notionalUsd: number): number {
  const keys = Object.keys(spec.leverage).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!keys.length) throw new Error("no leverage_estimates");
  const k = keys.find((x) => notionalUsd <= x) ?? keys.at(-1)!;
  return 1 / spec.leverage[String(k)];
}
/** Highest leverage you can OPEN at (initial margin binds): venue leverage / initial multiplier. */
export function maxOpenLeverage(spec: MarginSpec, notionalUsd: number) { return 1 / (maintenanceRate(spec, notionalUsd) * spec.initialMultiplier); }

export type MarginView = {
  notionalUsd: number; maintenanceUsd: number; initialUsd: number; leverageUsed: number;
  liquidationPrice: number | null; distanceToLiqPct: number | null; stopBeforeLiq: boolean | null; lossCanExceedMargin: true;
};
/**
 * Isolated view: `collateralUsd` is the equity standing behind this position (the posted margin for isolated, or the
 * dedicated equity share for cross). Liquidation happens when collateral + unrealized P&L ≤ threshold × maintenance(P).
 * Long:  C + q(P − E) = t·m·q·P  →  P = (q·E − C) / (q(1 − t·m)).
 * Short: C + q(E − P) = t·m·q·P  →  P = (C + q·E) / (q(1 + t·m)).
 */
export function marginView(spec: MarginSpec, dir: "long" | "short", qty: number, entry: number, collateralUsd: number, stop?: number | null): MarginView {
  const notional = Math.abs(qty) * entry;
  const m = maintenanceRate(spec, notional);
  const t = spec.liqThreshold;
  const q = Math.abs(qty);
  let liq: number | null = null;
  if (q > 0) liq = dir === "long" ? (q * entry - collateralUsd) / (q * (1 - t * m)) : (collateralUsd + q * entry) / (q * (1 + t * m));
  if (q > 0 && collateralUsd <= t * m * notional) liq = entry; // under-collateralized at entry: liquidatable immediately
  else if (liq != null && liq <= 0) liq = null; // cannot be liquidated by price falling to zero
  const dist = liq == null ? null : Math.abs(liq - entry) / entry;
  const stopBeforeLiq = stop == null || liq == null ? (liq == null ? true : null) : dir === "long" ? stop > liq : stop < liq;
  return {
    notionalUsd: +notional.toFixed(4), maintenanceUsd: +(notional * m).toFixed(4), initialUsd: +(notional * m * spec.initialMultiplier).toFixed(4),
    leverageUsed: collateralUsd > 0 ? +(notional / collateralUsd).toFixed(3) : Infinity,
    liquidationPrice: liq == null ? null : +liq.toFixed(6), distanceToLiqPct: dist == null ? null : +(dist * 100).toFixed(3),
    stopBeforeLiq, lossCanExceedMargin: true,
  };
}
