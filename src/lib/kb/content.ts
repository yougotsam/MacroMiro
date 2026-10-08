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

Every order pays the ask and cancels if it is not filled. Nothing rests one cent under. A filled ticket is held to the clock. Price range: 4¢–75¢. Clock: 5s after open to 30s before close. The index has to clear half the last minute's noise, and the last 30 seconds cannot be going the wrong way. A matching 30-minute lean is $2, or $5 if the ticket is 35¢ or cheaper. A flat or opposing lean is $1. A news window does not raise the $5 cap. One open ticket per contract. If the official index socket drops, a perp mark no older than 2 seconds can pick the side at $1. It does not settle the ticket. The perpetual book is a separate Kalshi margin order. The only written rule is docs/STRATEGY.md.`,
  },
  {
    id: "entry",
    title: "Entry",
    body: `The only written rule is docs/STRATEGY.md. This page repeats it. It does not add a second rule.

The day lean does not have to agree. YES continuation needs the index above the line and above the 20 EMA, with RSI under 70. NO is the mirror. An RSI under 30 with a bullish wick can buy a cheap YES. An RSI over 70 with a bearish candle can buy NO. A 0.618 bounce with the candle or the 20 EMA also takes. Missing RSI and the 20 EMA sits. A missing book does not block. Zero volume does not sit. The spread width does not sit.

Price range: 4¢–75¢. Clock: 5s after open to 30s before close. Both the bid and the ask have to be posted. Size is $1, $2, or $5. One ticket per contract. The day stops at $15 down. A count of losing trades does not stop it. A filled ticket is held to the clock. Resting orders are pulled 30 seconds before settlement.

Spark reads the Fed, CPI, jobs, and oil pages and writes one sentence. Firecrawl fetches those pages. Neither one sends the order. A quiet calendar does not freeze the book.`,
  },
  {
    id: "size",
    title: "Size and record",
    body: `$1 to $5 a ticket while the account is under $50. A cheaper, faster ticket gets the larger clip. A second clip only if the price got cheaper. Stop at $15 down. A losing streak does not stop the desk. Never the whole balance.

The desk buys only when the 30-second move agrees with the line and the ticket is 4¢ to 75¢. To stop orders, set the begin file to 0.

data/ledger.jsonl is the scan record. Old claims of 16 wins are not in that file.`,
  },
];
