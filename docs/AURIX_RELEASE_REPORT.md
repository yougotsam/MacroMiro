# AURIX-X — Release Report / Honest Verification Status

Date: October 9, 2026
Input: uploaded `MacroMiro-desk-brain-mirofish.zip`; source branch `desk-brain-mirofish`.
Output: modified complete repository ZIP intended for a NEW review branch. NOT pushed to GitHub.
**Release verdict: NOT READY FOR LIVE AUTONOMOUS TRADING.**

## What was actually changed
- `src/lib/desk/settlement.ts`: quarter-hour CF Benchmark averaging window fixed
  to `(close−60 seconds, close]`; missing locally observed prints fail unless an authenticated, count/time-matched Kalshi official final-minute accumulator supplies the authoritative aggregate; no index values are fabricated.
- `src/lib/desk/feeds.ts`: index freshness validation; captures official Kalshi final-minute
  60-second accumulator to cross-check locally reconstructed ticks.
- `src/lib/desk/engine.ts`: validates shard 2, official market price grid,
  quote/index freshness and accumulator, true event-specific fees, and explicit
  data/strategy-readiness diagnostics. Probabilities remain UNCALIBRATED, therefore no live order.
- `src/lib/desk/kalshi-read.ts`: market/event fee override lookup, market-specific legal
  price increments, missing shard detection, and fail-closed parsing of critical
  financial exposure fields.
- `src/lib/desk/gate.ts`: NaN/missing prices and forecast validation, maker bids on market tick grid.
- `src/lib/desk/risk.ts`: validate numeric sizes and current account snapshot, stop-latch corruption
  cannot silently reset, disk overrides disabled.
- `src/lib/desk/oms.ts`: all live order submissions blocked pending reviewed model;
  ambiguous sends stay unresolved/risk reserved instead of auto-`not_found`;
  corrupt journal fails closed.
- `src/lib/desk/config.ts`: model version/release gate; research bounds ($3/order,
  $9 aggregate risk, -$5 day worst). Heuristic +4 percentage-point feature adjustment disabled.
- NEW `src/lib/desk/sniper.ts`: parameterized technical research features (Fibonacci pockets, candidate order blocks, RSI divergence, VWAP, CVD, EMA, MACD, Bollinger, ATR, ADX) and 13-point
  grouped evidence with multi-timeframe readiness checks. NOT falsely treated as a calibrated
  settlement probability. Missing true market data => ineligible.
- NEW `src/lib/desk/intelligence.ts`: read-only Spark/MiroFish/Firecrawl seed/Alexandria
  status and explicit-time news veto. No LLM narrative is converted into pYES.
- `src/components/envelope.tsx`: perps cockpit no longer submits orders to retired fire route
  or displays an invented 15.2× default leverage.
- Replaced old contradictory `docs/STRATEGY.md`, `HANDOFF.md`, `HANDOFF-PROMPT.md`,
  `README.md`, and `AGENTS.project.md`. Original content retained in clearly marked
  `docs/archive/*` historical files.
- Retired legacy 767-line test suite archived with evidence; new
  `src/lib/desk/desk.test.ts` plus `aurix.test.ts` cover current rules. They must be
  run under Bun after dependency installation; no claim of a full green suite.

## Three verification passes
1. SOURCE / MECHANICS: verified Kalshi docs for official 15m averaging,
   market-specific `price_ranges`, and event-level fee overrides. Compared
   these against actual TS implementation.
2. EXECUTION / SCOPE: inspected actual order-post references in TS/TSX; only
   `src/lib/desk/oms.ts` uses signed desk order transport. Perps `perp-fire` is
   HTTP 410 in the input ZIP. No independent deployed-server security probe made.
3. OFFLINE CODE / TESTS: TypeScript AST/parser pass and real Node runtime
   smoke exercise using transpiled source modules (settlement tick boundary,
   missing-tick refusal or verified official-aggregate recovery, market grids, invalid forecasts, sniper insufficient
   data, bad risk snapshot, and corrupted risk latch).

## Tests NOT run / cannot be claimed
- `bun test`: Bun unavailable in this environment.
- `npm run typecheck`, `npm run lint`, build: project dependencies could not be
  installed offline. No CI service linked.
- Authenticated Kalshi WebSocket/REST/Pyth, trade/fee/settlement historical
  reconciliation, execution/fill integration: no API credentials or live runtime.
- Backtest on 328 reported unique contracts: user-provided history contains
  missing settlement reference fields and is NOT validated as a training dataset.
- MiroFish backend, Firecrawl API, Spark/Alexandria keys, clocks, task scheduling:
  source integration visible, live correctness not verifiable from repository ZIP.
- 200 real/forced OMS HTTP timeout & partial-fill tests with current deployment
  and order journal concurrency: not yet executed.

## Critical remaining engineering for the complete strategy
**P0 — production containment / CI:**
- Run dependency installation, `bun test`, `npm run typecheck`, `npm run lint`,
  `npm run check:auth`, plus HTTP-route and source-to-Kalshi demo integration
  tests. Diagnose and fix actual failures rather than bypassing them.
- Verify trade history ownership and revoke unknown trade-writing credentials.
- Authoritative OMS reconciliation across restarts/concurrent workers; 200 forced
  ambiguous timeout/partial fill trials without duplicate exposure.
- Verify shard 2 funded balance with actual Kalshi account. Never auto-transfer funds.
- Confirm each product's live event rules, source authorization and
  event fee overrides, time-to-expiry, quote precision and perps permission.

**P1 — feature data and real predictive validation:**
- Persistent 15m and 1h spot/futures OHLCV covering at least the required EMA200
  warm-up and confirmed pivots; real matched-volume, CVD/aggressor data and market depth.
- Full non-repainting BOS/MSS/liquidity sweep/FVG/OB/Golden Pocket detector coupled
  to structurally valid strategy-entry candidate state, not simplistic indicator voting.
- Calibrated contract-level model trained on unique outcomes with purged temporal
  holdout; compare to Kalshi bid/ask probability and a simple strike-distance/
  time-to-expiry/volatility benchmark; calculate *actual after-cost edge*.
- Treat MiroFish forecasts and Spark/Alexandria event claims as contextual until
  empirical incremental after-cost value is demonstrated.
- Separate independently built Kalshi perpetual exchange/margin/leverage/funding,
  liquidation and bracket-emergency execution; disabled until then.

## Safe handoff to GitHub agent
1. Create `fix/aurix-x-2026-10-09` from `desk-brain-mirofish`.
2. Apply the complete modified repository tree as a CHANGESET; do not wipe git history
   or overwrite runtime secrets/data. Review changed `src/`, `docs/`, and tests.
3. Run project dependency install and exact scripts; repair **all** reported failures.
4. Prove P0 execution/credential/risk/OMS safety and P1 probability dataset and model.
5. Merge only after PR review. Keep `CALIBRATED_MODEL_APPROVED = false` unless a
   separately reviewed, out-of-sample positive after-cost calibration release exists.
   Do NOT flip it just because a unit test passes or to make the dashboard say BUY.

## Verified docs (sources reviewed 2026-10-09)
- https://docs.kalshi.com/websockets/cfbenchmarks-value
- https://docs.kalshi.com/api-reference/events/get-event
- https://docs.kalshi.com/api-reference/orders/create-order-v2
- https://docs.kalshi.com/llms.txt
