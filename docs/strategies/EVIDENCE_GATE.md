# Evidence gate

This page is the lock on four tools. None of them change a live ticket until the scorecard says a setup is eligible. The live price band, the 4¢ taker floor, the 1¢ maker floor, and the dollar caps are unchanged.

## What the research says

Kalshi's own trade history shows a favorite-longshot bias: favorites win a bit more often than their price, and longshots are too expensive. Makers, not takers, keep more of that after fees. A last-window entry has been the pattern people point at when the favorite, the last one-minute push, and a tight spread all agree. Order-flow imbalance leads that push when the trades are real. Position size, when it is used, is a quarter of the Kelly fraction of the edge, then cut again by the caps we already have.

Sources to read beside this file: the Kalshi fee schedule, and the desk's own paper results in `docs/strategies/STRATEGY_REGISTRY.md`. Those paper results are still negative. That is why nothing here is allowed to send.

## The four locks

1. **Scorecard** (`src/lib/deskc/scorecard.ts`). Every settled decision keeps the model's probability, the market price, the fee result, and the expiry. Brier and log loss are scored against the price itself. Overlapping rows for the same expiry are dropped. The model is not refit on the rows it is scored on.
2. **Promotion** (`src/lib/deskc/promotion.ts`). A setup stays RESEARCH until all of these are true on the purged rows: at least 300 settled decisions, the model's Brier beats the price at 95% confidence, after-fee result is positive, and no row in the window is stale. Two bad walk-forward windows in a row send it back to RESEARCH. There is no hand-promote switch.
3. **Resolution rider** (`src/lib/deskc/rider.ts`). The last 90 seconds, favorite inside the existing 4¢–72¢ band, closed 1-minute momentum, spread of at most two ticks, and order flow in the same direction. If flow is missing, the minute move has to be at least two standard deviations or the rider sits. The last 45 seconds still need the existing lock fraction. The live sender does not import this file.
4. **Quarter Kelly** (`src/lib/deskc/sizing.ts`). Used only after promotion. Stake is `0.25 × edge / odds`, then cut by the $3 order cap and the open-risk caps. A missing file, a wrong model version, or a stale calibration stakes $0. A research setup keeps the flat budget.

Percent-of-account mode stays off. `pctModeInterlock` returns no unless an eligible setup also has a positive fill record. Even then, flipping the mode is a separate owner step.

## Phase 2C, still required before LIMITED_LIVE

From `docs/product/PRD.md`. This pull request does not check these boxes.

- An owner-approved perps mandate. The aggressive profile is still proposed. The conservative one was rejected.
- Demo-order and kill-switch tests against the locked perps order manager.
- A separate request to turn on LIMITED_LIVE. Paper or shadow evidence is not that request.
- The 15-minute book does not get a higher cap from this file. The day stop stays −$15.
