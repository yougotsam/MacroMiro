export type KbDoc = { id: string; title: string; body: string };

/** Screen copy of docs/STRATEGY.md. If this drifts, the markdown file wins. */
export const KB: KbDoc[] = [
  {
    id: "rule",
    title: "Rule",
    body: `The product is seven Kalshi perpetuals: Bitcoin, Ether, Solana, XRP, gold, silver, and the S&P. A long needs a swept low, a gap up, and funding that is not charging longs. A short is the mirror. The order rests. News can sit a trade out. It cannot choose the side. Fifteen-minute tickets and meme coins are not this plan.`,
  },
  {
    id: "entry",
    title: "Entry",
    body: `No sweep, no gap, no trade. The stop sits past the sweep. Half comes off at 1 times the risk. The rest comes off at 2.5 times. After the half, the stop moves to the entry and then trails. A click that does not carry the sweep and the gap is refused.`,
  },
  {
    id: "size",
    title: "Size and record",
    body: `If the stop is hit, the loss is 8% of the pile. Three losses in a row are 24% and end the day. Down 25% and the account stops. One or two losses do not. There is no measured win rate on this account yet.`,
  },
];
