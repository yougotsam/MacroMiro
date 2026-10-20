export type KbDoc = { id: string; title: string; body: string };

/** Screen copy of docs/STRATEGY.md. If this drifts, the markdown file wins. */
export const KB: KbDoc[] = [
  {
    id: "rule",
    title: "Rule",
    body: `Every pass scans four 15-minute Kalshi tickets.

Bitcoin KXBTC15M can be bought. The price is the BRTI 60-second average on the Kalshi websocket.
Ethereum KXETH15M can be bought. The price is ETHUSD_RTI on that same socket.
Solana KXSOL15M can be bought. The price is SOLUSD_RTI on that same socket.
XRP KXXRP15M can be bought. The price is XRPUSD_RTI on that same socket.
Gold KXGOLD15M can be bought. The price is the finished Pyth 1-minute close.
A perp price does not settle the ticket. If the official socket is down, a perp mark no older than 2 seconds can pick the side. One quiet coin does not freeze the others.

Every order is a resting bid under the ask. A filled ticket is held to the clock. Price range: 4¢–72¢. Nothing above 72¢. Clock: 5s after open to 30s before close. A trade needs a pullback, not a price that is already past the average. One open ticket per contract. The perpetual book is a separate Kalshi margin order and it is not sending. The live rule is the desk code. This page only repeats it.`,
  },
  {
    id: "entry",
    title: "Entry",
    body: `The only written rule is docs/STRATEGY.md. This page repeats it. It does not add a second rule.

The day lean does not pick the side. Price sitting above the 20-minute average is not a trade. YES needs a pullback: RSI under 30 with a bullish wick, a 62%–79% fib pocket, or the price back inside a bull gap. NO is the mirror, with RSI over 70. Missing those sits. A missing book does not block. Zero volume does not sit. The spread width does not sit.

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
