export type KbDoc = { id: string; title: string; body: string };

/** Screen copy of docs/STRATEGY.md. If this drifts, the markdown file wins. */
export const KB: KbDoc[] = [
  {
    id: "rule",
    title: "Rule",
    body: `Every pass scans eleven 15-minute Kalshi tickets off one balance.

Bitcoin, Ethereum, Solana, XRP, and Dogecoin settle on the CF Benchmarks 60-second average.
Gold, silver, and oil settle on Pyth. Pound, euro, and yen settle on Pyth too.
All of them spend the same dollars. There is no second wallet.
A perp price does not settle the ticket. One quiet market does not freeze the others.

Every order is a resting bid under the ask. A filled ticket is held to the clock. Price range: 21¢–72¢. Nothing at or under 20¢. Nothing above 72¢. Clock: 5s after open to 30s before close. A trade needs a pullback, not a price that is already past the average. One open ticket per contract. The perpetual book is a separate Kalshi margin order and it is not sending. The live rule is the desk code. This page only repeats it.`,
  },
  {
    id: "entry",
    title: "Entry",
    body: `The live rule is the desk. This page repeats it.

The day lean does not pick the side. Price sitting above the 20-minute average is not a trade. RSI does not open a trade and does not move the chance. YES can come from a 62%–79% fib pocket plus a wick or a gap, a 38%–62% Fibonacci retracement of the last swing with a candle back up, a pullback to a rising 20-minute average, a sweep of the lows that closes back up, a return into a demand candle, price back inside a bull gap, or a sniper price setup on that same side. NO is the mirror. An upper wick is not an entry. None of these set the chance. The settlement math does. The sniper cannot cancel a trade. London and New York are labeled on the shot. They do not turn the scanner off.

Price range: 21¢–72¢. Clock: 5s after open to 30s before close. Both the bid and the ask have to be posted. Size is $1, $2, or $3. One ticket per contract. The day stops at $15 down. A count of losing trades does not stop it. A filled ticket is held to the clock. Resting orders are pulled 30 seconds before settlement.

Spark reads the Fed, CPI, jobs, and oil pages and writes one sentence. Firecrawl fetches those pages. Neither one sends the order. A quiet calendar does not freeze the book.`,
  },
  {
    id: "size",
    title: "Size and record",
    body: `$1 to $3 a ticket. Stop at $15 down. A losing streak does not stop the desk. Never the whole balance.

The desk buys only on a pullback, and only when the ticket is 21¢ to 72¢. To stop orders, set the begin file to 0.

data/ledger.jsonl is the scan record. Old claims of 16 wins are not in that file.`,
  },
];
