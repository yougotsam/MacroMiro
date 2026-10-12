/**
 * Paper candidate generator and ranker. Uses what the collector already records per scan (settlement-model
 * probability, executable Kalshi asks + displayed size, fee multiplier, confluence, strike, time left) and the
 * named sniper setups (setups.ts) from the nearest earlier indicator snapshot. PAPER ONLY: nothing here can place,
 * amend or cancel an order, and the score is EXPERIMENTAL (not a calibrated probability).
 */
import { setupsOf, type IndicatorRow, type Dir } from "@/lib/desk/setups";
import { entryCost, sizeFor, type Side } from "./pnl";
import { P_CLAMP } from "@/lib/desk/config";

export type ConfState = "NOT_READY" | "TRUE_ZERO" | "INVALID_DATA" | "VALID_SCORE";
type Evidence = { score?: number; setup?: string; eligible?: boolean; points?: Record<string, number>; missing?: string[]; tags?: string[] };
/** 13-point confluence state. Missing warm-up is NOT_READY, never a valid 0/13. */
export function confState(e: Evidence | null | undefined): ConfState {
  if (!e) return "NOT_READY";
  if ((e.missing ?? []).some((m) => /complete 15m bars|complete 1h bars/.test(m))) return "NOT_READY";
  const pts = Object.values(e.points ?? {});
  if (typeof e.score !== "number" || !Number.isFinite(e.score) || e.score < 0 || e.score > 13 || (pts.length && pts.reduce((a, b) => a + b, 0) !== e.score)) return "INVALID_DATA";
  return e.score === 0 ? "TRUE_ZERO" : "VALID_SCORE";
}

export const PER_TICKER_CAP_USD = 3; // approved limit
/** Transparent experimental ranking weights (recorded with every candidate). */
export const WEIGHTS = { evCents: 1, confluencePoint: 0.5, setupHit: 1, researchCents: 1, spreadCents: -0.5, thinDepth: -1 } as const;

export type ObsRow = {
  ts: string; ticker: string | null; series: string; close: string | null; tte_s: number | null; strike: number | null; spot: number | null;
  p: number | null; fee_multiplier: number | null; failed_gate: string | null; model?: string;
  exec: { yes_ask: number | null; yes_ask_size: number | null; no_ask: number | null; no_ask_size: number | null; yes_bid: number | null; no_bid: number | null; complete?: boolean } | null;
  confluence: { long: { score: number; setup: string; eligible: boolean }; short: { score: number; setup: string; eligible: boolean } } | null;
  approval?: { p_cal: number | null } | null;
};

export type Candidate = {
  ts: string; ticker: string; series: string; close: string; side: Side; dir: Dir;
  entryPrice: number; availableQty: number; qty: number; strike: number | null; spot: number | null; tteSec: number;
  structure: string; setups: string[]; confluence: number | null; confluenceState: ConfState; confluencePoints: Record<string, number> | null; confluenceMissing: string[]; coreEligible9: boolean; spread: number | null;
  modelProbExperimental: number; calibration: "UNCALIBRATED (no owner-approved calibrator)" | "CALIBRATED"; calibratedProb: number | null;
  kalshiImplied: number; fee: number; evUsd: number; evPerContract: number;
  researchAdj: number; researchNote: string;
  score: number; weights: typeof WEIGHTS;
  plan: string; deskGate: string | null; feeMultiplier: number;
};

export function candidatesOf(o: ObsRow, ind: IndicatorRow | null, research: { adj: (side: Side) => number; note: string } = { adj: () => 0, note: "no timely research event" }): Candidate[] {
  if (o.p == null || !o.exec || !o.ticker || !o.close || o.tte_s == null) return [];
  // Unknown event fee → no paper entry (never default the multiplier to 1).
  if (o.fee_multiplier == null || !Number.isFinite(o.fee_multiplier) || o.fee_multiplier <= 0) return [];
  // A probability pinned at the model's clamp (e.g. 2% / 98%) is a floor, not an estimate: EV against a 0.1¢ ask
  // would be fake. No paper candidate from clamped probabilities.
  if (o.p <= 1 - P_CLAMP + 1e-9 || o.p >= P_CLAMP - 1e-9) return [];
  const hits = ind ? setupsOf(ind) : [];
  const out: Candidate[] = [];
  for (const side of ["yes", "no"] as Side[]) {
    const price = side === "yes" ? o.exec.yes_ask : o.exec.no_ask;
    const size = side === "yes" ? o.exec.yes_ask_size : o.exec.no_ask_size;
    if (price == null || size == null || !(price > 0 && price < 1)) continue;
    const mult = o.fee_multiplier;
    const qty = sizeFor(price, size, PER_TICKER_CAP_USD, mult);
    if (qty < 1) continue;
    const dir: Dir = side === "yes" ? "long" : "short";
    const pSide = side === "yes" ? o.p : 1 - o.p;
    const { fee } = entryCost({ side, price, qty, feeMultiplier: mult });
    const evUsd = +(qty * (pSide - price) - fee).toFixed(4);
    // 13-pt confluence from the collector's Coinbase 15m/1h snapshot (the obs-row evaluator only has ~1 h of index
    // prints, so its score is always the not-ready 0 and is ignored here).
    const ev = (ind?.sniper?.[dir] ?? null) as Evidence | null;
    const state = confState(ev);
    const confScore = state === "VALID_SCORE" || state === "TRUE_ZERO" ? (ev!.score as number) : null;
    const bid = side === "yes" ? o.exec.yes_bid : o.exec.no_bid;
    const spread = bid != null ? +(price - bid).toFixed(4) : null;
    const setups = hits.filter((h) => h.dir === dir).map((h) => h.name);
    const radj = research.adj(side);
    const score = +(WEIGHTS.evCents * (evUsd / qty) * 100 + WEIGHTS.confluencePoint * (confScore ?? 0) + WEIGHTS.setupHit * setups.length + WEIGHTS.researchCents * radj * 100 + WEIGHTS.spreadCents * (spread ?? 0.05) * 100 + (size < qty * 3 ? WEIGHTS.thinDepth : 0)).toFixed(3);
    out.push({
      ts: o.ts, ticker: o.ticker, series: o.series, close: o.close, side, dir, entryPrice: price, availableQty: size, qty,
      strike: o.strike, spot: o.spot, tteSec: o.tte_s, structure: ev?.setup ?? "NONE", setups, confluence: confScore, confluenceState: state, confluencePoints: ev?.points ?? null, confluenceMissing: ev?.missing ?? [], coreEligible9: Boolean(ev?.eligible) && state === "VALID_SCORE", spread,
      modelProbExperimental: +pSide.toFixed(4), calibration: o.approval?.p_cal != null ? "CALIBRATED" : "UNCALIBRATED (no owner-approved calibrator)",
      calibratedProb: o.approval?.p_cal ?? null, kalshiImplied: price, fee, evUsd, evPerContract: +(evUsd / qty).toFixed(4),
      researchAdj: radj, researchNote: research.note, score, weights: WEIGHTS,
      plan: "buy at the ask as taker, hold to settlement ($1/contract if the side wins); no early exit", deskGate: o.failed_gate, feeMultiplier: mult,
    });
  }
  return out;
}

/**
 * Selection configs, fixed in advance (no tuning on the reported windows). Each sees ONE contract's candidates in
 * time order and returns at most one entry, using only data available at that scan.
 */
export type Config = { id: string; label: string; select: (cs: Candidate[]) => Candidate | null };
const firstWhere = (f: (c: Candidate) => boolean) => (cs: Candidate[]) => cs.find(f) ?? null;
const ev0 = (c: Candidate) => c.evPerContract > 0 && c.tteSec >= 60;
const valid = (c: Candidate) => c.confluenceState === "VALID_SCORE";
/** C/E: observe until ≤ 7 min left (≥ 8 min watched), then take the highest-ranked candidate AT that scan. */
const timeAware = (useResearch: boolean) => (cs: Candidate[]) => {
  const at = cs.find((c) => c.tteSec <= 420 && c.tteSec >= 60);
  if (!at) return null;
  const now = cs.filter((c) => c.ts === at.ts && c.evPerContract + (useResearch ? c.researchAdj : 0) > 0);
  return now.sort((a, b) => b.score - a.score)[0] ?? null;
};
const bucketOk = (c: Candidate) => (c.tteSec > 600 ? c.evPerContract >= 0.08 : c.tteSec > 300 ? c.evPerContract >= 0.05 : c.tteSec >= 60 ? c.evPerContract >= 0.03 && valid(c) && (c.confluence ?? 0) >= 5 : false);
export const CONFIGS: Config[] = [
  { id: "A_settlement", label: "A settlement baseline: first EV>0 after fees (≥ 60 s left)", select: firstWhere(ev0) },
  { id: "B_first_setup", label: "B first-eligible setup: first EV>0 with an aligned named setup", select: firstWhere((c) => ev0(c) && c.setups.length > 0) },
  { id: "B7_research", label: "B7 research 7+: first EV>0 with VALID 13-pt score ≥ 7", select: firstWhere((c) => ev0(c) && valid(c) && (c.confluence ?? 0) >= 7) },
  { id: "B9_core", label: "B9 core 9+: first EV>0 that meets the production eligibility (9+, 4 families, flow)", select: firstWhere((c) => ev0(c) && c.coreEligible9) },
  { id: "C_time_ranked", label: "C time-aware: watch ≥ 8 min, then highest-ranked at ≤ 7 min left", select: timeAware(false) },
  { id: "D_conviction", label: "D high-conviction by expiry bucket (EV ≥ 8¢ >10m, ≥ 5¢ 5–10m, ≥ 3¢ + valid 5/13 1–5m)", select: firstWhere(bucketOk) },
  { id: "E_research", label: "E research-enhanced C (news counts only if detected before entry)", select: timeAware(true) },
];
