# MacroMiro

Kalshi only. One deposit, $100 to $200, split by you into a prediction pile and a margin pile. This repo does not move cash between them.

## The product

Perpetuals. A buy rests on the bid. A sell rests on the ask. The stop and the target are the sliders. The button is not inside the lock yet, so do not click it.

Fifteen-minute contracts are paper. A published test of Bitcoin windows (Aug 29–Sep 27, 2026) lost money after Kalshi's fee on both a late-favorite trade and a model-versus-price trade. Source: predictionmarketspicks.com, checked Oct 26, 2026. That is one site's test, not our own score. It is enough to stop treating 15-minute taker trades as the business.

Meme coins are not the path. A rug check can see mint authority, freeze authority, and a crowded holder list. It cannot see a slow dump. Sniper fees and failed transactions are paid even when the coin dies.

## The six rules

1. Only the London open (2–5am New York), the New York morning (8:30–11), or the New York afternoon (2–3pm).
2. Price sweeps a prior high or low and closes back through it.
3. A gap in that same direction is present. Otherwise no trade.
4. The order rests. It does not cross.
5. One trade is 1% of the pile. The day halts at 4%. The kill switch is 10%.
6. News does not place the order. Sending stays off until you say otherwise in writing.

The sequence lives in `src/lib/desk/ict.ts`. The lock lives in `src/lib/desk/guard.ts`. Neither has a measured win rate on this account. Turning the switch on tonight does not create one.

## What is still in the repo

Old files are still on disk. Deleting them in one pass breaks the screen. The screen no longer states the old dollar caps. That lie is the one that was in front of you.
