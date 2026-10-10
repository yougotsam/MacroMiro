/**
 * Paper candidate generator and ranker. Uses what the collector already records per scan (settlement-model
 * probability, executable Kalshi asks + displayed size, fee multiplier, confluence, strike, time left) and the
 * named sniper setups (setups.ts) from the nearest earlier indicator snapshot. PAPER ONLY: nothing here can place,
 * amend or cancel an order, and the score is EXPERIMENTAL (not a calibrated probability).
 */
import { setupsOf, type IndicatorRow, type Dir } from "@/lib/desk/setups";
import { entryCost, sizeFor, type Side } from "./pnl";

export const PER_TICKER_CAP_USD = 3; // approved limit
/** Transparent experimental ranking weights (recorded with every candidate). */
export const WEIGHTS = { evCents: 1, confluencePoint: 0.5, setupHit: 1, researchCents: 1 } as const;

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
  structure: string; setups: string[]; confluence: number;
  modelProbExperimental: number; calibration: "UNCALIBRATED (no owner-approved calibrator)" | "CALIBRATED"; calibratedProb: number | null;
  kalshiImplied: number; fee: number; evUsd: number; evPerContract: number;
  researchAdj: number; researchNote: string;
  score: number; weights: typeof WEIGHTS;
  plan: string; deskGate: string | null;
};

export function candidatesOf(o: ObsRow, ind: IndicatorRow | null, research: { adj: (side: Side) => number; note: string } = { adj: () => 0, note: "no timely research event" }): Candidate[] {
  if (o.p == null || !o.exec || !o.ticker || !o.close || o.tte_s == null) return [];
  const hits = ind ? setupsOf(ind) : [];
  const out: Candidate[] = [];
  for (const side of ["yes", "no"] as Side[]) {
    const price = side === "yes" ? o.exec.yes_ask : o.exec.no_ask;
    const size = side === "yes" ? o.exec.yes_ask_size : o.exec.no_ask_size;
    if (price == null || size == null || !(price > 0 && price < 1)) continue;
    const mult = o.fee_multiplier ?? 1;
    const qty = sizeFor(price, size, PER_TICKER_CAP_USD, mult);
    if (qty < 1) continue;
    const dir: Dir = side === "yes" ? "long" : "short";
    const pSide = side === "yes" ? o.p : 1 - o.p;
    const { fee } = entryCost({ side, price, qty, feeMultiplier: mult });
    const evUsd = +(qty * (pSide - price) - fee).toFixed(4);
    const conf = o.confluence?.[dir];
    const setups = hits.filter((h) => h.dir === dir).map((h) => h.name);
    const radj = research.adj(side);
    const score = +(WEIGHTS.evCents * (evUsd / qty) * 100 + WEIGHTS.confluencePoint * (conf?.score ?? 0) + WEIGHTS.setupHit * setups.length + WEIGHTS.researchCents * radj * 100).toFixed(3);
    out.push({
      ts: o.ts, ticker: o.ticker, series: o.series, close: o.close, side, dir, entryPrice: price, availableQty: size, qty,
      strike: o.strike, spot: o.spot, tteSec: o.tte_s, structure: conf?.setup ?? "NONE", setups, confluence: conf?.score ?? 0,
      modelProbExperimental: +pSide.toFixed(4), calibration: o.approval?.p_cal != null ? "CALIBRATED" : "UNCALIBRATED (no owner-approved calibrator)",
      calibratedProb: o.approval?.p_cal ?? null, kalshiImplied: price, fee, evUsd, evPerContract: +(evUsd / qty).toFixed(4),
      researchAdj: radj, researchNote: research.note, score, weights: WEIGHTS,
      plan: "buy at the ask as taker, hold to settlement ($1/contract if the side wins); no early exit", deskGate: o.failed_gate,
    });
  }
  return out;
}

export type Config = { id: string; label: string; enter: (c: Candidate) => boolean };
const inFinal = (s: number) => (c: Candidate) => c.tteSec <= s && c.tteSec >= 15;
export const CONFIGS: Config[] = [
  { id: "A_settlement", label: "A: settlement model EV > 0 after fees (any time ≥ 60 s left)", enter: (c) => c.evPerContract > 0 && c.tteSec >= 60 },
  { id: "A_final10", label: "A, final 10 minutes only", enter: (c) => c.evPerContract > 0 && inFinal(600)(c) },
  { id: "A_final3", label: "A, final 3 minutes only", enter: (c) => c.evPerContract > 0 && inFinal(180)(c) },
  { id: "A_edge5", label: "A with ≥ 5¢ EV/contract cushion", enter: (c) => c.evPerContract >= 0.05 && c.tteSec >= 60 },
  { id: "B_setups", label: "B: A + at least one aligned named setup", enter: (c) => c.evPerContract > 0 && c.tteSec >= 60 && c.setups.length > 0 },
  { id: "B_sniper", label: "B sniper: aligned confluence ≥ 7 and EV ≥ 3¢", enter: (c) => c.evPerContract >= 0.03 && c.tteSec >= 60 && c.confluence >= 7 },
  { id: "C_research", label: "C: B + pre-trade research adjustment", enter: (c) => c.evPerContract + c.researchAdj > 0 && c.tteSec >= 60 && c.setups.length > 0 },
];
