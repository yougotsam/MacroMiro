# Evidence gate

This page is the lock on four tools. None of them change a live ticket until the scorecard says a setup is eligible. The live price band, the 4¢ taker floor, the 1¢ maker floor, and the dollar caps are unchanged.

## What the research says

Kalshi's own trade history shows a favorite-longshot bias: favorites win a bit more often than their price, and longshots are too expensive. Makers, not takers, keep more of that after fees. A last-window entry has been the pattern people point at when the favorite, the last one-minute push, and a tight spread all agree. Order-flow imbalance leads that push when the trades are real. Position size, when it is used, is a quarter of the Kelly fraction of the edge, then cut again by the caps we already have.

Sources to read beside this file: the Kalshi fee schedule, and the desk's own paper results in `docs/strategies/STRATEGY_REGISTRY.md`. Those paper results are still negative. That is why nothing here is allowed to send.

## The four locks

1. **Scorecard** (`src/lib/deskc/scorecard.ts`). Every settled decision keeps the model's probability, the market price, the fee result, and the expiry. Brier and log loss are scored against the price itself. Overlapping rows for the same expiry are dropped. The model is not refit on the rows it is scored on.
2. **Promotion** (`src/lib/deskc/promotion.ts`). A setup stays RESEARCH until all of these are true on the purged rows: at least 300 settled decisions, the model's Brier beats the price at 95% confidence, after-fee result is positive, and no row in the window is stale. Two bad walk-forward windows in a row send it back to RESEARCH. There is no hand-promote switch.
3. **Resolution rider** (`src/lib/deskc/rider.ts`). The last 90 seconds, favorite inside the live price band (18¢–72¢; the code reads `PRICE_MIN`), closed 1-minute momentum, spread of at most two ticks, and order flow in the same direction. If flow is missing, the minute move has to be at least two standard deviations or the rider sits. The last 45 seconds still need the existing lock fraction. The live sender does not import this file.
4. **Quarter Kelly** (`src/lib/deskc/sizing.ts`). Used only after promotion. Stake is `0.25 × edge / odds`, then cut by the $3 order cap and the open-risk caps. A missing file, a wrong model version, or a stale calibration stakes $0. A research setup keeps the flat budget.

Percent-of-account mode stays off. `pctModeInterlock` returns no unless an eligible setup also has a positive fill record. Even then, flipping the mode is a separate owner step.

## Phase 2C, still required before LIMITED_LIVE

Paper replay run 2026-10-20T09:25:51Z. Profile `aggressive-experimental/v1`, still PROPOSED. Script `scripts/perps/sim.ts 145`. Markets: BTC, ETH, gold, SOL, XRP. Configs: strict9 and aggr7, maker and taker, risk 10/15/20/25%, plus aggr7+intel at 15%. Costs charged inside the replay: the venue fee tier, funding prints that settle during the hold, 2 ticks of slippage, and one half-spread taken from the 2026-10-15 collector book (not the book at the decision). File `data/perps/sim-1792488351114.json`. Every row is labeled `CANDLE_ONLY_NOT_EXECUTABLE`. A candle is not a fill. No live order was sent. The perps order lock was not opened. The 15-minute caps were not touched.

Venue history actually returned: BTC, ETH, SOL, and XRP 1-minute candles from 2026-06-03 through 2026-10-20 (about 145 days). Gold from 2026-09-10 (the market is newer). Zero and inverted prints were dropped. The loader does not apply a full-sample 20% median band. That band uses later prices and, on this tape, would have deleted September and October. The candidate's own short-window check is unchanged.

- strict9 fired 0 times on every market.
- SOL and XRP fired 0 times. After zero prints were dropped, 9,921 SOL and 10,950 XRP fifteen-minute buckets were incomplete, so the setup never armed. That is a missing tape, not a tested loss.
- BTC aggr7 maker: 332 candle-proxy trades, net −$392.14 (gross −$59.40, fees $333.49, funding $0.76). Taker: 340 trades, net −$470.65.
- ETH aggr7 maker: 121 trades, net −$178.31. Taker: 132 trades, net −$294.86.
- Gold aggr7 maker: 20 trades, net −$6.71. Gold aggr7 taker: 21 trades (2026-09-30 to 2026-10-20), net +$41.65 after $12.10 of fees. Funding on those 21 holds was $0. Gold's venue history is one print a day, and none of those prints fell inside a hold. Max drawdown on that cell was 9.6% of the $500 start.
- Risk 10%, 15%, 20%, and 25% produced the same contracts on every market. A tighter cap bound first. Those four rows are one result, not four.
- The intel calendar is used only after it was fetched (2026-10-17T11:13:35Z). It did not add or remove a trade.
- Across the five markets, every config sums to $0 or worse. aggr7 maker sums to −$577.16. aggr7 taker sums to −$723.86. The gold taker cell is the only positive cell. It is 21 candle proxies on one market. Win probability is UNKNOWN. Fourteen of those 21 proxies finished green. That is not a probability the next one wins.

These boxes stay open. This replay does not check them.

- An owner-approved perps mandate. The aggressive profile is still proposed. The conservative one was rejected.
- Demo-order and kill-switch tests against the locked perps order manager.
- A separate request to turn on LIMITED_LIVE. Paper or shadow evidence is not that request.
- The 15-minute book does not get a higher cap from this file. The day stop stays −$15.
