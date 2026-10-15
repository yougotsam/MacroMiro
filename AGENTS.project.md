# AURIX-X project rules
Read `docs/STRATEGY.md` and `docs/archive/AURIX_RELEASE_REPORT-2026-10-09.md` first.
One canonical evidence-based Kalshi settlement-probability strategy;
technical indicators provide independently tested structure and timing
evidence, never heuristic percentage boosts. MiroFish, Firecrawl, Spark2
and Alexandria contribute timestamped context; their narrative confidence
is not a calibrated contract win probability.

All orders must use `src/lib/desk/oms.ts` → risk check. No direct alternate
API POST paths. No missing prices, synthetic settlement prints or silent
risk-latch overrides. Perpetual orders remain disabled pending a separate
production release. Live deployment stays blocked while
CALIBRATED_MODEL_APPROVED is false.

No fabricated tests, fill prices, profitability claims, or source certainty.
Unrelated NFC/transit features remain unless explicitly authorized for removal.

## How to work (2026-10-14)
`main` is the only line. Branch from the latest `origin/main`. Pull requests target `main`, never `desk-brain-mirofish`. Do not keep committing on `fix/aurix-x`. One writer at a time. PR #2 is already contained in `main`; do not merge it.
Superseded: `docs/archive/**` and any note that says the day stop is −$5 or that `src/lib/scan/edge.ts` is the order brain. Those files stay on disk. They do not win over the six docs above.

## Perps (2026-10-13)
Risk profile: AGGRESSIVE_EXPERIMENTAL v1 (proposed, paper/demo). The conservative perps profile is REJECTED BY OWNER, SUPERSEDED. The −$15 daily stop applies to Kalshi 15m only.
Perps orders stay LOCKED (`PERPS_ORDERS_LOCKED`, `lockedTransport`). Collector: `bun scripts/perps/collect.ts` (read-only WS). Sim: `bun scripts/perps/sim.ts 21`. Report: `bun scripts/perps/report.ts`. Candle replay is not a fill (`CANDLE_ONLY_NOT_EXECUTABLE`, see `docs/strategies/EXECUTION_EVAL.md`). The selector is `src/lib/perps/candidates.ts`. `src/lib/scan/perp-desk.ts` does not authorize orders.
