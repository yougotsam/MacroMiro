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
Gold KXGOLD15M can be bought. The price is the finished Pyth 1-minute close.
A perp price is not allowed to fill a missing index. One quiet coin does not freeze the others.

Every order pays the ask and cancels if it is not filled. Nothing rests one cent under. A filled ticket is held to the clock. A normal ticket must cost 25¢ to 45¢. On CPI, the jobs report, or a Fed decision the band is 20¢ to 40¢ and the clip is four times larger. The perpetual book is a separate Kalshi margin order. The only written rule is docs/STRATEGY.md.`,
  },
  {
    id: "entry",
    title: "Entry",
    body: `The only written rule is docs/STRATEGY.md. This page repeats it. It does not add a second rule.

The day lean is the last 30 minutes of the official index. If that lean is missing, a live push through the line can be the lean. With the lean, buy that side when the live print agrees and the move is bigger than the last minute's noise. Counter-trend is allowed when that push stalls at the high or the low and more than 3 minutes are left. A missing book does not block.

Tickets cost 25¢ to 45¢. Above that, the win is too small. New bets stop in the last 90 seconds, the first 20 seconds, and in the last 3 minutes if price is still on the line. On CPI, the jobs report, or a Fed decision the band is 20¢ to 40¢ and the size is four times the normal clip. Size is otherwise $1 to $5. A second clip only if the new price is cheaper. The day stops at $15 down. Three losses in a row pause every new order for 60 minutes. A filled ticket is held to the clock.

Spark reads the Fed, CPI, jobs, and oil pages and writes one sentence. Firecrawl fetches those pages. Neither one sends the order. A quiet calendar does not freeze the book.`,
  },
  {
    id: "size",
    title: "Size and record",
    body: `$1 to $5 a ticket while the account is under $50. A cheaper, faster ticket gets the larger clip. A second clip only if the price got cheaper. Stop at $15 down. Three losses in a row pause every new order for 60 minutes. Never the whole balance.

The desk buys only when the index has already moved and the ticket is 25¢ to 45¢. To stop orders, set the begin file to 0.

data/ledger.jsonl is the scan record. Old claims of 16 wins are not in that file.`,
  },
];
