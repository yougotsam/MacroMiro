/**
 * Perps risk profiles (paper/demo). Live use needs an explicit owner approval. Nothing here sends orders.
 * CONSERVATIVE_V1 is kept only as a record: REJECTED BY OWNER, SUPERSEDED (2026-10-12).
 */
import { marginView, maxOpenLeverage, maintenanceRate, type MarginSpec } from "./margin";

export const AGGRESSIVE_EXPERIMENTAL_VERSION = "aggressive-experimental/v1";
export type Profile = {
  version: string; status: "PROPOSED" | "REJECTED_SUPERSEDED";
  riskAtInvalidationPct: number;      // fraction of dedicated equity lost if the stop (thesis invalidation) is hit, after costs
  maxAccountMarginUsePct: number;     // initial margin of all positions + resting orders / equity
  maxSingleMarginUsePct: number;      // one market's initial margin / equity
  maxCorrelatedMarginUsePct: number;  // one correlation group's initial margin / equity
  maxLeverageFractionOfVenue: number; // 1.0 = up to the venue's per-asset max open leverage
  minStopToLiqRatio: number;          // stop must sit at most this fraction of the way to the liquidation price
  drawdownWarnPct: number[];          // warnings only
  operatorDrawdownLimitPct: number | null; // set by the operator; null = no automatic halt (warnings still fire)
  entry: "auto_maker_or_taker";       // picked by total execution cost
  eventTrades: "allowed_if_after_cost_positive";
  funding: "cost_benefit_and_crowding_feature";
  exits: string[];
};
export const CONSERVATIVE_V1_REJECTED = { status: "REJECTED_SUPERSEDED", maxNotionalUsd: 100, maxLeverage: 3, riskUsd: 1, dailyStopUsd: -5, weeklyStopUsd: -15, maxPositions: 2, makerOnly: true, newsFundingBlackouts: true } as const;

export const RISK_CONFIGS = [0.10, 0.15, 0.20, 0.25] as const;
export function aggressiveProfile(riskAtInvalidationPct: (typeof RISK_CONFIGS)[number] | number = 0.15, operatorDrawdownLimitPct: number | null = null): Profile {
  return {
    version: AGGRESSIVE_EXPERIMENTAL_VERSION, status: "PROPOSED", riskAtInvalidationPct,
    maxAccountMarginUsePct: 0.9, maxSingleMarginUsePct: 0.75, maxCorrelatedMarginUsePct: 0.85, maxLeverageFractionOfVenue: 1,
    minStopToLiqRatio: 0.8, drawdownWarnPct: [0.2, 0.35, 0.5], operatorDrawdownLimitPct,
    entry: "auto_maker_or_taker", eventTrades: "allowed_if_after_cost_positive", funding: "cost_benefit_and_crowding_feature",
    exits: ["native_bracket_tp_sl", "partial_at_1R", "break_even_after_partial", "native_trailing_after_1R", "thesis_invalidation_exit", "reduce_only_always", "never_reverse"],
  };
}

export type OpenExposure = { ticker: string; group: string; initialMarginUsd: number };
export type SizeInput = {
  profile: Profile; equityUsd: number; spec: MarginSpec; ticker: string; group: string; dir: "long" | "short";
  entry: number; stop: number; feeRateIn: number; feeRateOut: number; slipPerContract: number; fundingPctOverHold: number;
  open?: OpenExposure[]; contractStep?: number;
};
export type SizeResult = {
  qty: number; notionalUsd: number; leverage: number; initialMarginUsd: number; riskUsd: number; riskPctOfEquity: number;
  binding: string; liq: ReturnType<typeof marginView> | null; reject: string | null;
};
/**
 * Size by risk at invalidation, with costs included in the per-contract loss. Then cap by the venue max leverage,
 * the account/single/correlated margin-use caps, and the rule that the stop must hit well before liquidation.
 */
export function sizePosition(x: SizeInput): SizeResult {
  const step = x.contractStep ?? 1;
  const stopDist = Math.abs(x.entry - x.stop);
  const lossPer = stopDist + x.entry * x.feeRateIn + x.stop * x.feeRateOut + x.slipPerContract + Math.max(0, x.fundingPctOverHold) * x.entry;
  const fl = (v: number) => Math.max(0, Math.floor(v / step + 1e-9) * step);
  if (!(stopDist > 0) || !(x.entry > 0) || x.equityUsd <= 0) return { qty: 0, notionalUsd: 0, leverage: 0, initialMarginUsd: 0, riskUsd: 0, riskPctOfEquity: 0, binding: "invalid", liq: null, reject: "invalid entry/stop/equity" };
  const open = x.open ?? [];
  const used = open.reduce((s, o) => s + o.initialMarginUsd, 0);
  const usedSame = open.filter((o) => o.ticker === x.ticker).reduce((s, o) => s + o.initialMarginUsd, 0);
  const usedGroup = open.filter((o) => o.group === x.group).reduce((s, o) => s + o.initialMarginUsd, 0);
  const caps: [string, number][] = [["risk_at_invalidation", fl((x.profile.riskAtInvalidationPct * x.equityUsd) / lossPer)]];
  // margin caps: initial margin per contract ≈ entry × maintRate × multiplier (rate at the candidate notional; iterate once)
  const imPer = (q: number) => x.entry * maintenanceRate(x.spec, Math.max(1, q) * x.entry) * x.spec.initialMultiplier;
  const capBy = (budget: number) => { let q = fl(budget / imPer(1)); q = fl(budget / imPer(q)); return q; };
  caps.push(["account_margin_use", capBy(x.profile.maxAccountMarginUsePct * x.equityUsd - used)]);
  caps.push(["single_market_margin_use", capBy(x.profile.maxSingleMarginUsePct * x.equityUsd - usedSame)]);
  caps.push(["correlated_margin_use", capBy(x.profile.maxCorrelatedMarginUsePct * x.equityUsd - usedGroup)]);
  caps.push(["venue_max_leverage", fl((x.profile.maxLeverageFractionOfVenue * maxOpenLeverage(x.spec, x.entry * 1000) * x.equityUsd) / x.entry)]);
  caps.sort((a, b) => a[1] - b[1]);
  let [binding, qty] = caps[0];
  // stop must sit no more than minStopToLiqRatio of the way to the liquidation price (collateral = this position's equity share)
  const liqOk = (q: number) => {
    const v = marginView(x.spec, x.dir, q, x.entry, x.equityUsd - used, x.stop);
    if (v.liquidationPrice == null) return true;
    return Math.abs(x.entry - x.stop) <= x.profile.minStopToLiqRatio * Math.abs(x.entry - v.liquidationPrice);
  };
  while (qty > 0 && !liqOk(qty)) { qty = fl(qty * 0.9); binding = "stop_vs_liquidation"; }
  const notional = qty * x.entry;
  const im = qty > 0 ? notional * maintenanceRate(x.spec, notional) * x.spec.initialMultiplier : 0;
  return {
    qty, notionalUsd: +notional.toFixed(2), leverage: +(notional / x.equityUsd).toFixed(2), initialMarginUsd: +im.toFixed(2),
    riskUsd: +(qty * lossPer).toFixed(2), riskPctOfEquity: +((qty * lossPer) / x.equityUsd * 100).toFixed(2), binding,
    liq: qty > 0 ? marginView(x.spec, x.dir, qty, x.entry, x.equityUsd - used, x.stop) : null,
    reject: qty > 0 ? null : `size 0 (binding: ${binding})`,
  };
}

export function drawdownState(profile: Profile, peakEquity: number, equity: number) {
  const dd = peakEquity > 0 ? (peakEquity - equity) / peakEquity : 0;
  const warnings = profile.drawdownWarnPct.filter((w) => dd >= w).map((w) => `drawdown ≥ ${w * 100}%`);
  const halted = profile.operatorDrawdownLimitPct != null && dd >= profile.operatorDrawdownLimitPct;
  return { drawdownPct: +(dd * 100).toFixed(2), warnings, halted, reason: halted ? `operator limit ${profile.operatorDrawdownLimitPct! * 100}% reached` : null };
}
