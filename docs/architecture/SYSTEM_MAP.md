# System map (actual code, 2026-10-12 @ fix/aurix-x)
Status key: REUSE = works as is · ADAPT = needs a venue adapter · LOCKED = present, intentionally off · RESEARCH = context only.

| Layer | Module | Status | Notes |
|---|---|---|---|
| Indicators / ICT | `src/lib/desk/sniper.ts`, `indicators.ts`, `setups.ts` | REUSE | 13-pt confluence, 8 setups. TREND_PULLBACK needs a real retrace (c3faea0). BOS needs displacement; CVD needs contiguous flow. |
| Bar data | `src/lib/desk/market-data.ts` (Coinbase public candles/trades/signed delta) | REUSE | Signals for BTC/ETH/SOL/XRP. Coinbase has no gold. |
| Perps data | `src/lib/perps/kalshi-perps-read.ts` | NEW, REUSE | Signed GET only: markets, book, trades, candles, funding estimate/history, fee tiers, risk params, balance, exchange status, price band. |
| Perps candidates | `src/lib/perps/candidates.ts` | NEW, RESEARCH | Maker entry, swing/ATR stop, 1R/2R targets, fees + funding, depth/funding gates, break-even win rate. Never TRADE. |
| Perps orders | `src/lib/perps/order-adapter.ts`, `oms.ts` | LOCKED | OMS logic is real (idempotent cid, journal, reconcile, unknown-order block, recovery, kill/flatten, native triggers) and tested against `FakeExchange`. The only venue transport is `lockedTransport`, which throws. |
| Perps collector | `src/lib/perps/stream.ts`, `scripts/perps/collect.ts` | NEW | Margin WS: ticker/trade/orderbook_delta, per-sid seq check, 1m/5m/15m candles from trades, REST status/balance/risk every 60 s. Writes `$DATA_ROOT/perps/stream/`. |
| Perps sizing/margin/exits | `mandate.ts`, `margin.ts`, `manage.ts` | NEW | Shared by sim and OMS. |
| Perps sim / rank / intel | `sim.ts`, `rank.ts`, `intel.ts`, `scripts/perps/{sim,report,intel-trace}.ts` | NEW, RESEARCH | Causal replay on venue 1m candles. Intel reuses macro-calendar, grid/features, spark-templates, research files. |
| Pair scanner | `src/lib/desk/pair-scan.ts`, `scripts/kalshi-pair-scan.ts` | NEW, read-only | |
| Kalshi 15m data | `src/lib/desk/feeds.ts`, `observe.ts`, `kalshi-read.ts`, `scripts/desk-observe.ts` | REUSE | GET-only collector. Outcome recovery on restart. Shard-2 fails closed. |
| Kalshi 15m model | `src/lib/desk/settlement.ts`, `evaluator.ts`, `gate.ts`, `approval.ts` | REUSE (Kalshi only) | Uncalibrated. `CALIBRATED_MODEL_APPROVED=false`. |
| Kalshi OMS / risk | `src/lib/desk/oms.ts`, `risk.ts`, `exposure.ts`, `recovery.ts` | LOCKED (Kalshi only) | Sole order writer for event contracts. Do not reuse its $ limits for perps. |
| Paper / selection | `src/lib/paper/*`, `scripts/paper/run.ts` | REUSE | A–E configs, realistic portfolio replay. |
| Ops | `src/lib/ops/operating-mode.ts`, `scripts/ops/*` | REUSE | Mode file. Firecrawl gated. `no-orders-check.ts`. |
| Research | `src/lib/grid/*`, `intel/*`, `research/*`, MiroFish, Spark 2, Alexandria | RESEARCH | Weight 0 in decisions. Paid calls need an open round. |
| Loop engineering | `src/lib/loop/*`, `scripts/loop/*` | NEW (paper) | STATE.md + lessons, blind strategy checker, risk watchdog (own process, heartbeat, fail-closed), AI maker A/B. See `docs/operations/LOOP_ENGINEERING.md`. |
| UI | `src/routes/paper.tsx`, `intel-grid.tsx`, `research.tsx` | REUSE | /paper is the operator page. A perps panel is planned for 2B. |

Data flow (perps, 2A): `perpsReader()` → candles (venue 1m→15m, 1h) + book + funding → `buildPerpsCandidate()` → `scripts/perps/trace.ts` → `/workspace/data/perps/trace-*.json`.

**Retirement candidates (not deleted):** `src/lib/scan/*` envelope/NFC-era scanners not used by the desk; `scripts/desk-replay.ts` (superseded by paper/run); legacy Spark brief `src/lib/live/spark.server.ts` (gated off). Remove only after references and tests pass without them.
