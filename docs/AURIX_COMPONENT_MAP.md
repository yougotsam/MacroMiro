# AURIX-X component and call-path map
Date: 2026-10-09. Based on the actual supplied branch ZIP, not a live production inspection.

| Capability | Existing implementation | AURIX-X connection | Status |
|---|---|---|---|
| Kalshi market/book/exchange | `src/lib/desk/kalshi-read.ts` | `engine.ts` reads snapshot/orderbook/actual fee | Source updated; no live authenticated verification |
| Official CF/Pyth feeds | `src/lib/desk/feeds.ts` | `engine.ts` + `settlement.ts` | Boundary repaired; authenticated accumulator can recover local packet gaps without invented prices; runtime entitlement unknown |
| 15m settlement probability | `src/lib/desk/settlement.ts` | `engine.ts` evaluates correct reference | Parametric hypothesis; calibration NOT proven |
| Executable YES/NO pricing | `src/lib/desk/gate.ts` | Receives venue market `price_ranges`, actual event fee | Source updated; no live-fill validation |
| Indicator diagnostics | `src/lib/desk/features.ts` | `engine.ts` | Original EMA/RSI/candle/structure only; old +/-4pp adjustment disabled |
| Sniper multi-indicator engine | **NEW** `src/lib/desk/sniper.ts` | Research-only diagnostics in `engine.ts` | Some computations available; no genuine volume/205-hour history => ineligible |
| Account risk | `src/lib/desk/risk.ts`, `config.ts` | Risk executes again in OMS | -$5 day stop, $3 order cap, $9 aggregate; no override |
| Only trade writer | `src/lib/desk/oms.ts` | Engine submit | CALIBRATED_MODEL_APPROVED false => hard blocked |
| Ledger | `src/lib/desk/ledger.ts` | Decisions/outcomes | Existing; historical completeness unverified |
| MiroFish | `src/lib/intel/mirofish.ts` | **NEW** read-only `src/lib/desk/intelligence.ts` | Reads latest stage and source age; NOT probability calibration |
| Firecrawl | `src/lib/live/firecrawl.server.ts`, `spark.server.ts`, `src/lib/intel/seed.server.ts` | Spark, MiroFish seed → intelligence bridge | Existing routes preserved; cannot verify live keys/workers |
| Spark2/Spark | `src/lib/live/spark.server.ts`, `src/lib/live/spark.ts` | Published `spark-latest.json` inspected read-only | Not authorized to set pYES/pNO |
| Alexandria | `src/lib/live/alexandria.ts` | Latest tools and verified macro schedule read-only | Historical event-to-outcome calibration library NOT implemented |
| News calendar | `src/lib/live/alexandria.ts` (`desk-news.json`) | `scheduledVeto` with explicit timezone | 30m pre/15m post for named high-impact events; freshness validation still needed |
| Kalshi perps | `src/routes/api/live/perp-fire.ts`, `src/lib/scan/perp-desk.ts` | Standalone cockpit | Order route is 410 disabled, cockpit now reports disabled |
| Dashboard control | `src/routes/api/live/heart.ts` | Separate authenticated controls | Existing control guard kept; no running server penetration test |
| Deprecated reference | `src/lib/scan/edge.ts` | None | Referenced in former handoffs but ABSENT in actual ZIP |

## Canonical decision flow
Risk/control safety → exchange status/shard → official index/market rules → timestamp and settlement completeness →
volatility/probability model → optional strategy/indicator evidence → exact current YES/NO executable quotes and event fees →
quantified after-cost positive edge → independent risk + OMS reconciliation → append-only decision/outcome log.

## Operational caveat
The current engine **cannot claim that all indicators influence live orders**. `sniper.ts` is newly implemented
as an evidence calculator, but the only live source currently wired to its input is the index time series.
That source does not contain exchange-traded volume or 205 completed one-hour candles. Ineligible evidence
is explicitly returned and the production approval gate remains off.

## Why not auto-enable
No calibrated pYES model, authenticated live quotes/fills, outcome-labeled unique replay,
true market-data history, or verified CI tests were supplied. With no evidence, aggressive size
is not a remedy for an invalid forecast.
