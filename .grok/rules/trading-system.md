# Trading system

The only entry law is `README.md` and `src/lib/desk/fresh-law.ts`.

A 15-minute side comes from the 9-period average, the 21-period average, and RSI 14 on closed 1-minute prices. No retest, no trade. A settlement chance is not an entry.

One trade posts at most 4% of the pile it spends. The day stops at 8% of that pile. Unknown cash is no trade.

Bitcoin still settles on the 60-print average. Gold still settles on the Pyth close named in the contract. A stale feed is no trade. The feed does not choose the side.

15-minute sending stays off until a human turns the flag on. Firecrawl does not place an order.

Perpetual orders rest on the correct side of the book. There is no perpetual entry signal yet.
