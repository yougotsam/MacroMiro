/**
 * Order budget = min($3, the whole event-contract balance, room to the −$15 day stop, room under the exposure cap).
 * Crypto, gold, and the currencies spend that one number. Kalshi still keeps the dollars on two engines;
 * the order path moves the cost across right before it sends.
 */
import { DAILY_STOP_USD, MAX_OPEN_WORST_USD, MAX_ORDER_COST_USD } from "./config";
import { dayWorstOf, type AccountSnapshot } from "./risk";

export function roomBudget(s: AccountSnapshot | null): number {
  if (!s) return 0;
  const daily = dayWorstOf(s) - DAILY_STOP_USD;
  const exposure = MAX_OPEN_WORST_USD - (s.openWorst + s.restWorst + s.pendingWorst);
  const cash = (s.shard2Cash ?? 0) + (s.shard0Cash ?? 0);
  const b = Math.min(MAX_ORDER_COST_USD, daily, exposure, cash);
  return b > 0 ? Math.floor(b * 10_000 + 1e-6) / 10_000 : 0;
}
