/**
 * Order budget = min($3, the whole event-contract balance, room to the −$15 day stop, room under the exposure cap).
 * Crypto, gold, and the currencies spend that one number. Kalshi still keeps the dollars on two engines;
 * the order path moves the cost across right before it sends.
 */
import { DAILY_STOP_USD, MAX_OPEN_WORST_USD, MAX_ORDER_COST_USD, WINDOW_EQUITY_CAP } from "./config";
import { dayWorstOf, type AccountSnapshot } from "./risk";

export function roomBudget(s: AccountSnapshot | null): number {
  if (!s) return 0;
  const daily = dayWorstOf(s) - DAILY_STOP_USD;
  const exposure = MAX_OPEN_WORST_USD - (s.openWorst + s.restWorst + s.pendingWorst);
  const cash = (s.shard2Cash ?? 0) + (s.shard0Cash ?? 0);
  const b = Math.min(MAX_ORDER_COST_USD, daily, exposure, cash);
  return b > 0 ? Math.floor(b * 10_000 + 1e-6) / 10_000 : 0;
}

/**
 * Half-Kelly for a contract that costs `price` and pays $1.
 * f = 0.5 × (b·p − (1−p)) / b, then at most 15% of equity, then at most the $3 order cap.
 * The order path still spends roomBudget. This number cannot exceed it.
 */
export function halfKellyStake(p: number, price: number, equity: number): { stake: number; why: string } {
  if (!(p > 0 && p < 1) || !(price > 0 && price < 1) || !(equity > 0)) return { stake: 0, why: "bad inputs" };
  const b = (1 - price) / price;
  const f = 0.5 * ((b * p - (1 - p)) / b);
  if (!(f > 0)) return { stake: 0, why: "no edge" };
  const raw = Math.min(f, WINDOW_EQUITY_CAP) * equity;
  const stake = Math.round(Math.min(raw, MAX_ORDER_COST_USD) * 100) / 100;
  return { stake: Math.max(0, stake), why: "half kelly under the dollar cap" };
}
