/**
 * The perpetual plan. Numbers only. This file does not send.
 * Kalshi closes a perp with a stop and a target on the position:
 * PUT /trade-api/v2/margin/cross/positions/{ticker}/exit_trigger
 * A stop is not a liquidation. Liquidation is the exchange taking the trade.
 */

export const SCAN = [
  { ticker: "KXBTCPERP", name: "Bitcoin" },
  { ticker: "KXETHPERP", name: "Ether" },
  { ticker: "KXSOLPERP", name: "Solana" },
  { ticker: "KXXRPPERP", name: "XRP" },
  { ticker: "KXGOLDPERP", name: "Gold" },
  { ticker: "KXSILVERPERP", name: "Silver" },
  { ticker: "KXUS500PERP", name: "S&P 500" },
] as const;

export type Side = "long" | "short";

/** Stop beyond the sweep. Target is 2.5 times that distance. Half comes off at 1 times the distance. */
export function bracket(entry: number, sweep: number, side: Side): { stop: number; takeHalf: number; takeRest: number } | null {
  if (!(entry > 0) || !(sweep > 0)) return null;
  const risk = Math.abs(entry - sweep);
  if (!(risk > 0)) return null;
  if (side === "long") {
    const stop = Math.min(entry, sweep);
    if (!(stop < entry)) return null;
    const r = entry - stop;
    return { stop, takeHalf: entry + r, takeRest: entry + 2.5 * r };
  }
  const stop = Math.max(entry, sweep);
  if (!(stop > entry)) return null;
  const r = stop - entry;
  return { stop, takeHalf: entry - r, takeRest: entry - 2.5 * r };
}

/**
 * Long only if the sweep was of a low, funding is not charging longs hard, and the book is not crossed.
 * Short is the mirror. Funding is the 8-hour rate as a fraction. 0.0005 is 0.05%.
 */
export function bias(input: {
  sweep: "low" | "high" | null;
  gap: "yes" | "no" | null;
  funding: number | null;
  spread: number | null;
}): { side: Side; why: string } | null {
  if (input.spread != null && input.spread > 0.0015) return null;
  const funding = input.funding ?? 0;
  if (input.sweep === "low" && input.gap === "yes" && funding < 0.0005) {
    return { side: "long", why: "swept the low, gap up, funding not charging longs" };
  }
  if (input.sweep === "high" && input.gap === "no" && funding > -0.0005) {
    return { side: "short", why: "swept the high, gap down, funding not charging shorts" };
  }
  return null;
}
