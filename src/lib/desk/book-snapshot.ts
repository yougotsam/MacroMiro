/** Top of book from a Kalshi order book. The exchange sends bids only; the ask is the other side's bid. No orders. */

export type Level = { price: number; size: number };

export function bestBid(levels: [string, string][] | undefined): Level | null {
  if (!levels?.length) return null;
  const [p, s] = levels[levels.length - 1];
  const price = Number(p);
  const size = Number(s);
  if (!(price > 0) || !(size > 0)) return null;
  return { price, size };
}

/** Ask price is one minus the opposite bid. Size is that bid's size. Null when that bid is missing. */
export function impliedAsk(oppositeBid: Level | null): Level | null {
  if (!oppositeBid) return null;
  const price = Math.round((1 - oppositeBid.price) * 10000) / 10000;
  if (!(price > 0) || price >= 1) return null;
  return { price, size: oppositeBid.size };
}
