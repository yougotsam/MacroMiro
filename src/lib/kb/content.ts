export type KbDoc = { id: string; title: string; body: string };

/** Screen copy of docs/STRATEGY.md. If this drifts, the markdown file wins. */
export const KB: KbDoc[] = [
  {
    id: "rule",
    title: "Rule",
    body: `Every pass scans eight 15-minute Kalshi tickets.

Bitcoin, Ethereum, Solana, and XRP can be bought. They settle on the CF Benchmarks 60-second average.
Gold can be bought. It settles on the Pyth gold print.
Pound, euro, and yen can be bought: KXGBPUSD15M, KXEURUSD15M, KXUSDJPY15M. They settle on Pyth FX.GBP/USD, FX.EUR/USD, and FX.USD/JPY. Those three trade on a different cash board. If that board is empty, they are scanned and they sit.
A perp price does not settle the ticket. One quiet market does not freeze the others.

Every order is a resting bid under the ask. A filled ticket is held to the clock. Price range: 4¢–72¢. Nothing above 72¢. Clock: 5s after open to 30s before close. A trade needs a pullback, not a price that is already past the average. One open ticket per contract. The perpetual book is a separate Kalshi margin order and it is not sending. The live rule is the desk code. This page only repeats it.`,
  },
  {
    id: "entry",
    title: "Entry",
    body: `The live rule is the desk. This page repeats it.

The day lean does not pick the side. Price sitting above the 20-minute average is not a trade. YES needs a pullback: RSI under 30 with a bullish wick, a 62%–79% fib pocket plus a wick or a gap, or the price back inside a bull gap. NO is the mirror, with RSI over 70. A fib pocket with only the average under it sits. Missing those sits. A missing book does not block. Zero volume does not sit. The spread width does not sit.

Price range: 4¢–72¢. Clock: 5s after open to 30s before close. Both the bid and the ask have to be posted. Size is $1, $2, or $3. One ticket per contract. The day stops at $15 down. A count of losing trades does not stop it. A filled ticket is held to the clock. Resting orders are pulled 30 seconds before settlement.

Spark reads the Fed, CPI, jobs, and oil pages and writes one sentence. Firecrawl fetches those pages. Neither one sends the order. A quiet calendar does not freeze the book.`,
  },
  {
    id: "size",
    title: "Size and record",
    body: `$1 to $3 a ticket. Stop at $15 down. A losing streak does not stop the desk. Never the whole balance.

The desk buys only on a pullback, and only when the ticket is 4¢ to 72¢. To stop orders, set the begin file to 0.

data/ledger.jsonl is the scan record. Old claims of 16 wins are not in that file.`,
  },
];
