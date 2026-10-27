/**
 * The order budget is a fraction of the cash in the prediction pile.
 * Unknown cash is zero. This file does not send.
 */
import { pileRoom } from "./fresh-law";
import { TRADE_FRAC } from "./guard";
import { dayWorstOf, type AccountSnapshot } from "./risk";

export function roomBudget(s: AccountSnapshot | null): number {
  if (!s) return 0;
  const cash = (s.shard2Cash ?? 0) + (s.shard0Cash ?? 0);
  return pileRoom(cash, dayWorstOf(s));
}

/** Kept for older tests. The live budget is roomBudget, not this curve. */
export function halfKellyStake(p: number, price: number, equity: number): { stake: number; why: string } {
  if (!(p > 0 && p < 1) || !(price > 0 && price < 1) || !(equity > 0)) return { stake: 0, why: "bad inputs" };
  const b = (1 - price) / price;
  const f = 0.5 * ((b * p - (1 - p)) / b);
  if (!(f > 0)) return { stake: 0, why: "no edge" };
  const stake = Math.round(Math.min(f, TRADE_FRAC) * equity * 100) / 100;
  return { stake: Math.max(0, stake), why: "half of the edge, cut at the pile fraction" };
}