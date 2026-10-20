/**
 * Quarter-Kelly is for an ELIGIBLE setup only. A research setup keeps the flat budget it was already given.
 * A stale or mismatched file stakes $0 on the Kelly path. It does not change the flat path.
 */
import { MAX_ORDER_COST_USD, MODEL_VERSION, P_CLAMP } from "../desk/config";
import type { PromotionDoc } from "./promotion";

export type SizeInput = {
  setup: string;
  doc: PromotionDoc | null;
  calibrated: boolean;
  p: number;
  price: number;
  bankroll: number;
  flatBudget: number;
  roomTotal: number;
  roomTicker: number;
  roomCorrelated: number;
};

export function quarterKellyStake(i: SizeInput): { stake: number; why: string } {
  if (!i.doc) return { stake: 0, why: "promotion file missing" };
  if (i.doc.modelVersion !== MODEL_VERSION) return { stake: 0, why: "model version mismatch" };
  const verdict = i.doc.setups[i.setup];
  if (!verdict || verdict.state !== "ELIGIBLE") return { stake: clampFlat(i.flatBudget), why: "research flat budget" };
  if (!i.calibrated) return { stake: 0, why: "calibration stale" };
  const p = Math.min(P_CLAMP, Math.max(0, i.p));
  const price = i.price;
  if (!(price > 0) || price >= 1 || !(i.bankroll > 0)) return { stake: 0, why: "bad price or bankroll" };
  const odds = (1 - price) / price;
  const edge = p - price;
  if (!(edge > 0) || !(odds > 0)) return { stake: 0, why: "no edge" };
  const fraction = 0.25 * (edge / odds);
  const raw = fraction * i.bankroll;
  const cap = Math.min(MAX_ORDER_COST_USD, i.roomTotal, i.roomTicker, i.roomCorrelated, i.flatBudget);
  if (!(cap > 0)) return { stake: 0, why: "no room under the existing caps" };
  const stake = Math.round(Math.min(raw, cap) * 100) / 100;
  return { stake: Math.max(0, stake), why: "quarter kelly" };
}

function clampFlat(budget: number): number {
  if (!(budget > 0)) return 0;
  return Math.min(budget, MAX_ORDER_COST_USD);
}
