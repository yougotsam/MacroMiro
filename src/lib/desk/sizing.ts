/**
 * Order budget = min($3, cash on the crypto board, room to the −$15 day stop, room under the exposure cap).
 * Cash is included so the desk does not ask for $2.70 when the board only has $2.51.
 * The risk engine still checks every order independently.
 */
import { DAILY_STOP_USD, MAX_OPEN_WORST_USD, MAX_ORDER_COST_USD } from "./config";
import { dayWorstOf, type AccountSnapshot } from "./risk";

export function roomBudget(s: AccountSnapshot | null): number {
  if (!s) return 0;
  const daily = dayWorstOf(s) - DAILY_STOP_USD;
  const exposure = MAX_OPEN_WORST_USD - (s.openWorst + s.restWorst + s.pendingWorst);
  const b = Math.min(MAX_ORDER_COST_USD, daily, exposure, s.shard2Cash);
  return b > 0 ? Math.floor(b * 10_000 + 1e-6) / 10_000 : 0;
}
