---
name: probability-model
description: >
  Retired. Do not use RSI, a 7-versus-14 average, Fibonacci, or a Kelly bet
  on the Kalshi 15-minute desk. The live rule is docs/STRATEGY.md and
  src/lib/scan/edge.ts.
---

# Retired

This note used to say the index side needed two of three votes: a 7-versus-14 average, a Fibonacci zone, or RSI. That is not the live desk.

`src/lib/scan/edge.ts` does not read those fields. A ticket is the side the official index is already on, once the last 30 seconds agrees. If that print is missing, the move must clear half the last minute's noise. The ticket is 4¢ to 75¢. The spread width does not sit. Noise above 200 basis points sits. The written copy is `docs/STRATEGY.md`. Do not put the old votes back.
