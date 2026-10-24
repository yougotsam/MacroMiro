# AURIX-X project rules
Read `docs/STRATEGY.md` and `docs/archive/AURIX_RELEASE_REPORT-2026-10-09.md` first.
One canonical evidence-based Kalshi settlement-probability strategy;
technical indicators provide independently tested structure and timing
evidence, never heuristic percentage boosts. MiroFish, Firecrawl, Spark2
and Alexandria contribute timestamped context; their narrative confidence
is not a calibrated contract win probability.

All orders on the 15-minute book go through `src/lib/desk/oms.ts`. Perpetual orders go through `src/lib/perps/oms.ts` and `POST /api/live/perp-fire`. Neither path may invent a price. `CALIBRATED_MODEL_APPROVED` is true. `APPROVAL_POLICY_ENFORCED` is false.

No fabricated tests, fill prices, profitability claims, or source certainty.
Unrelated NFC/transit features remain unless explicitly authorized for removal.

## How to work (2026-10-14)
`main` is the only line. Branch from the latest `origin/main`. Pull requests target `main`, never `desk-brain-mirofish`. Do not keep committing on `fix/aurix-x`. One writer at a time. PR #2 is already contained in `main`; do not merge it.
Superseded: `docs/archive/**` and any note that says the day stop is −$5 or that `src/lib/scan/edge.ts` is the order brain. Those files stay on disk. They do not win over the six docs above.

## Perps
A perpetual is not a 15-minute contract. It has leverage. The 15-minute contract does not.
`src/lib/scan/perp-desk.ts` may authorize a lean when the book, the funding, and the push agree. The button sends that contract's leverage and a stop. Cancel, positions, and fills are real margin calls in `live-transport.ts`. Candle replay is still not a fill. `docs/archive/**` is history. A sentence there that says perps are locked does not win.
