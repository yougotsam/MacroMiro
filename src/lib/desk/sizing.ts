/**
 * The order budget is a fraction of the cash in the prediction pile.
 * Unknown cash is zero. This file does not send.
 */
import { pileRoom } from "./fresh-law";
import { dayWorstOf, type AccountSnapshot } from "./risk";

export function roomBudget(s: AccountSnapshot | null): number {
  if (!s) return 0;
  const cash = (s.shard2Cash ?? 0) + (s.shard0Cash ?? 0);
  return pileRoom(cash, dayWorstOf(s));
}
