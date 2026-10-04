---
name: probability-model
description: >
  How the KalshiBot normal-curve chance is used on this desk. Use when
  someone pastes probability-model.js or signal-generator.js. Do not
  replace the 15-minute votes with Binance, Polymarket, or a $25 Kelly bet.
---

# Probability model

The formula in `agents/skills/analysis/probability-model.js` is a normal curve. The distance of the price from the line, divided by how much it usually wiggles in the time left, becomes a chance from 1% to 99%.

On this desk that chance is computed from the official settlement index, not from Binance. Bitcoin uses BRTI. Ether and solana use their RTI. Gold uses the Pyth close. The code is the `chance` line in `src/lib/scan/edge.ts`.

## What gets a vote

The index picks the side. Two of three must agree: the 7-versus-14 average, a Fibonacci zone, or RSI. Then the ticket is bought only if its price is not higher than that chance. Paying 80¢ for a 60% chance is a no. The dollars bet stay $1.

## What was in that bot and is not used here

- Binance as the price that decides. The contract does not pay on Binance.
- Polymarket as a second price. This desk does not send a Polymarket order.
- Buying both sides. That bot turned it off because the two orders are not one fill.
- A bet sized by the Kelly formula up to $25. This account bets $1, then another $1, then a third, with the $5 and $10 caps.
- Trading only the first 4 minutes. This desk enters from 2 minutes after the open until the contract closes.
- The trend multiplier in `signal-generator.js`. It is passed in and then ignored. The name starts with an underscore. Our averages, Fibonacci, and RSI are the real votes.
- Selling early at a 15% gain. This order path only buys. The ticket is held to settlement.

A public grade of 2,788 bitcoin windows said this curve, used alone against Kalshi's price, lost to the price. It is a check against overpaying. It is not the whole strategy.
