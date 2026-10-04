---
name: envelope-desk
description: >
  The one Envelope trading rule. Use when changing the Kalshi 15-minute desk,
  the order function, the chart, Spark, or Firecrawl. The written copy is
  docs/STRATEGY.md. Do not put an older cents band or a second rule back.
---

# Envelope desk

One written rule: `docs/STRATEGY.md`. The ticket function is `src/lib/scan/edge.ts`. If they disagree, fix the function.

## Trade

Kalshi only. Tickets: KXBTC15M, KXETH15M, KXSOL15M, KXGOLD15M.
Up buys yes. Down buys no.
The chart can show the coin or the metal. The thing that pays the ticket is the official index: BRTI, ETHUSD_RTI, SOLUSD_RTI, or the Pyth gold close.

## Entry

Day lean is the last 30 minutes. A live push can stand in if that lean is missing. Counter-trend is allowed only when the push stalls and more than 3 minutes are left.

A normal ticket costs 25¢ to 45¢. During the 10 minutes before CPI, jobs, or the Fed, and the 15 minutes after, the band is 20¢ to 40¢ and the clip is four times. Skip the first 20 seconds and the last 90 seconds. In the last 3 minutes the index has to be well clear of the line.

Size is $1 to $5 under $50 cash. A second clip only if the price got cheaper, after 60 seconds. No third. Three losses pause every order for 60 minutes. The day stops at $15 down. A filled ticket is held to the clock. Every order pays the ask and cancels if it does not fill.

## Tools

Spark reads the calendars. It does not send the order. Files: `src/lib/live/spark.ts` and `src/lib/live/spark.server.ts`.
Firecrawl fetches pages. It does not send the order. File: `src/lib/live/firecrawl.server.ts`.
Perpetuals are the other engine. Skill: `kalshi-perps`. They use the margin account, not this cash.
MiroFish is the swarm on port 5001. Skill: `mirofish`. If it is down, do not invent a probability.
