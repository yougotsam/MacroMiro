/**
 * Order budget = min($3, room to the −$15 day stop (day worst already includes every open / resting / pending
 * worst case), room under the $12 exposure cap). The risk engine still checks every order independently.
 */
import { DAILY_STOP_USD, MAX_OPEN_WORST_USD, MAX_ORDER_COST_USD } from "./config";
import { dayWorstOf, type AccountSnapshot } from "./risk";

export function roomBudget(s: AccountSnapshot | null): number {
  if (!s) return 0;
  const daily = dayWorstOf(s) - DAILY_STOP_USD;
  const exposure = MAX_OPEN_WORST_USD - (s.openWorst + s.restWorst + s.pendingWorst);
  const b = Math.min(MAX_ORDER_COST_USD, daily, exposure);
  return b > 0 ? Math.floor(b * 10_000 + 1e-6) / 10_000 : 0;
}
