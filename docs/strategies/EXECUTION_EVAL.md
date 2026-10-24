# Execution evaluation

Candle replay is not a fill. `simulate()` in `src/lib/perps/sim.ts` labels every run `CANDLE_ONLY_NOT_EXECUTABLE`.

A 15-minute bar is used only when all 15 one-minute prints are present and aligned. A bucket with 10–14 minutes is reported as incomplete and dropped.

The decision-time funding rate is the last venue print with `tMs <= decideMs`. A missing print is UNKNOWN. It is not stored as 0. Rates that settle during a hold are the bill for that hold. They are not shown to the entry decision early.

`decidedAt` is the simulated decision time. It is not the wall clock of the machine running the replay.

The order book built from a candle close has size 0 and `bookKind: "synthetic_candle"`. The depth gate fails. `evaluateExecution()` refuses that book.

A venue book (`src/lib/perps/execution.ts`) can say how many contracts are displayed. Queue position is UNKNOWN. Kalshi's margin API does not publish it. A one-minute candle that touches both a stop and a target is AMBIGUOUS. The manager assumes the stop fills first. That is a rule, not a fact about the tape.

## Who picks the trade

`src/lib/perps/candidates.ts` is the research selector. It reports a break-even win rate and `winProbability: UNKNOWN`.

`src/lib/scan/perp-desk.ts` is the live lean. A pass sets `authorizesOrder`. It uses the leverage on that perpetual contract.

Live sends go through `src/lib/perps/oms.ts` and `src/lib/perps/live-transport.ts`. `PERPS_ORDERS_LOCKED` is false. The object in `order-adapter.ts` is not a sender. It throws.

## Price unit

Kalshi's perp quote is dollars per contract. P&L is `qty × price change`. Do not multiply by `contract_size` again. `contract_size` is already inside the quote (BTC near $8 means 0.0001 BTC).

## What is still missing

The collector now appends every `orderbook_snapshot`, `orderbook_delta`, `seq_gap` and `reconnect` to `book.jsonl` under the data directory (not git). `replayBooks()` rebuilds the book in a fresh process. A gap or reconnect marks the book stale. A stale or crossed book is not executable.

A 12-second read on 2026-10-15 08:35 UTC stored 12 snapshots and 0 deltas (no trades in that window). Replayed bests matched the live status file: BTC 8.067 / 8.085, gold 4.13 / 4.1383. The exchange reported `trading_active: false` (Thursday maintenance). That sample is displayed liquidity, not a fill.


At that print, KXBTCPERP was 8.1783 / 8.1786. A taker buy of 1,000 contracts could lift the displayed asks (vwap about 8.1786). Funding was +0.000220 per 8h, next at 04:00 UTC. The sniper candidate was NO_TRADE: there were no 15-minute bars on that call, so score 0, size 0, win probability UNKNOWN. The book being able to fill is not a setup.

KXGOLDPERP was about 4.1408 / 4.1409. KXETHPERP was about 2.4202 / 2.4203. Same NO_TRADE, same reason.


Probability baselines (Brier, log loss) stay empty until matched outcomes exist. `src/lib/perps/prob-edge.ts` returns null on an empty set.
