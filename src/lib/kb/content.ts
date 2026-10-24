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

Maker posts under the ask. Taker pays the ask. A filled ticket is held to the clock. Price range: 36¢–95¢. Nothing under 36¢. Nothing above 95¢. The chance still has to beat the price and the fee. A score of 11 adds a logit of 0.80. A score of 8 adds 0.45. Three settled losses in a row pause new orders for 20 minutes. One loss does not. One live order per contract. New orders stop inside the last 3 seconds. Resting bids are pulled in the last 45 seconds unless the crypto average is already 60% printed. The perpetual route is separate. PERPS_ORDERS_LOCKED is false, and the 15-minute engine does not call it. Meme coins are a third button on the same cash and do not send until a pool check passes. No pair is approved. The live rule is src/lib/desk/config.ts. This page only repeats it.`,
  },
  {
    id: "entry",
    title: "Entry",
    body: `The live rule is the desk. This page repeats it.

The day lean does not pick the side. Price sitting above the 20-minute average is not a trade. RSI does not open a trade and does not move the chance. YES can come from a 62%–79% fib pocket plus a wick or a gap, a 38%–62% Fibonacci retracement of the last swing with a candle back up, a pullback to a rising 20-minute average, a sweep of the lows that closes back up, a return into a demand candle, price back inside a bull gap, or a sniper price setup on that same side. NO is the mirror. An upper wick is not an entry. None of these set the chance. The settlement math does. The sniper cannot cancel a trade. London and New York are labeled on the shot. They do not turn the scanner off.

Price range: 36¢–95¢. Nothing under 36¢. Nothing above 95¢. New orders stop inside the last 3 seconds. Resting bids are pulled in the last 45 seconds unless the crypto average is already 60% printed. Size is at most $3. One live order per contract. The day stops at $15 down. Three settled losses in a row pause new orders for 20 minutes. A filled ticket is held to the clock.

Spark reads the Fed, CPI, jobs, and oil pages and writes one sentence. Firecrawl fetches those pages. Neither one sends the order. A fresh read that disagrees with the ticket sits it. A quiet or missing calendar does not freeze the book.`,
  },
  {
    id: "size",
    title: "Size and record",
    body: `$1 to $3 a ticket. Stop at $15 down. Three settled losses pause new orders for 20 minutes. One loss does not. Never the whole balance.

The desk buys from 36¢ to 95¢. A score of 11 adds a logit of 0.80 before the price is judged. A score of 8 adds 0.45. To stop orders, set the begin file to 0.

data/ledger.jsonl is the scan record. Old claims of 16 wins are not in that file.`,
  },
];
