# MacroMiro project rules

File 3. Read `README.md` first, then the trading section at the bottom of `AGENTS.md`, then this page. Do not read `docs/archive/` or `docs/STRATEGY.md` as rules. A sentence in those files does not win.

## What is decided

One deposit. Kalshi keeps a prediction balance and a margin balance. They do not spend each other. Cash moves in the Portfolio tab. This repo does not move it. Kalshi's API transfer was not the path the help page gave.

A 15-minute contract has no leverage. Its order, when one is sent, goes through `src/lib/desk/oms.ts`. Crypto settles on 60 one-second prints. Gold and currencies settle on a Pyth price.

A perpetual has the leverage printed on that contract. Cash posted for one contract is the price divided by that leverage. The live button is `POST /api/live/perp-fire`. A buy rests on the bid. A sell rests on the ask. Kalshi rejects a post-only order that would trade immediately. Size is how many contracts fit in the clip. The stop and the target are the slider values. Liquidation is not a stop. The button does not wait on the paper heartbeat file.

## What is not decided

When to enter. When to sell a 15-minute ticket before the window ends. How much of the deposit one trade may lose. A formula for a chance. A quiet chart. An old news card. A fixed dollar cap. This page does not invent those.

## Holes, on purpose

- The 15-minute engine still enforces the old dollar caps and the old sits. That code is `src/lib/desk/config.ts`, then `src/lib/desk/evaluator.ts`. They are not rules. They are the next code files.
- A resting perpetual order can sit there and never fill. An instant order that is allowed to cross is not built.
- The perpetual button has no day stop. One click can post the whole clip.
- The two balances are not one pile. If the margin balance is empty, the perpetual is rejected even when the prediction balance has cash.

## How to work

`main` is the only line. Do not invent a fill, a price, or a profit.
