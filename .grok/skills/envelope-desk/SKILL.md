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

The written numbers are in `docs/STRATEGY.md`. Do not put 25¢–45¢, a first-20-second skip, or a last-90-second skip back.

The side is the 1-minute index. YES continuation is above the line and above the 20 EMA, with RSI under 70. NO continuation is the mirror. An RSI under 30 with a bullish rejection can buy a cheap YES under the line. An RSI over 70 with a bearish candle can buy NO. A 0.618 bounce with the candle or the 20 EMA also takes. Missing RSI and 20 EMA sits. The spread width does not sit. The ticket is 4¢ to 75¢. Skip the first 5 seconds and the last 30 seconds. Noise above 200 basis points sits. A win pays $1 per contract.

Size is $1 to $5 under $50 cash. A second clip only if the price got cheaper, after 60 seconds. No third. Three losses pause every order for 60 minutes. The day stops at $15 down. A filled ticket is held to the clock. Every order pays the ask and cancels if it does not fill. The heart prints `[SCAN]` and `[STATUS]` on every pass. A sit names the gate. `volume_zero` and `lean_mismatch` are not gates.

## Tools

Spark reads the calendars. It does not send the order. Files: `src/lib/live/spark.ts` and `src/lib/live/spark.server.ts`.
Firecrawl fetches pages. It does not send the order. File: `src/lib/live/firecrawl.server.ts`.
Perpetuals are the other engine. Skill: `kalshi-perps`. They use the margin account, not this cash.
MiroFish is the swarm on port 5001. Skill: `mirofish`. If it is down, do not invent a probability.
