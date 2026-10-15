# Intelligence audit (after PR #3)

Main: `9b94dd38dc2bceba2c3c40790ba852a33142c8a9`.
This is an inventory. It does not turn research into a live order.

## What survived

`fix/aurix-x` and `desk-brain-mirofish` are old lines. They are inside the history that `main` already contains. They are not places to keep coding. PR #3 added the perps book path on top. It did not delete the 15-minute desk.

## Capability matrix

| Piece | State | Where | Can it send an order? | Does it change a decision today? |
|---|---|---|---|---|
| Kalshi 15-minute predictions | IMPLEMENTED_AND_CONNECTED | `src/lib/desk/evaluator.ts`, `settlement.ts`, `approval.ts`, `oms.ts` | LOCKED_EXECUTION. `CALIBRATED_MODEL_APPROVED` is false | Settlement math runs. Approval refuses without a calibrator |
| Kalshi pair scanner | IMPLEMENTED_BUT_RESEARCH_ONLY | pair scan in the desk tests | No | No live send |
| Kalshi perps | IMPLEMENTED_AND_CONNECTED as research | `src/lib/perps/candidates.ts`, `book-replay.ts`, `scripts/perps/collect.ts` | LOCKED_EXECUTION. `PERPS_ORDERS_LOCKED` is true | Sniper gates can say NO_TRADE. They cannot send |
| Firecrawl | IMPLEMENTED_BUT_RESEARCH_ONLY | `src/lib/perps/intel.ts` reads an events log | No | Only if a timestamp is before the decision. Weight on the nine features is 0 |
| Spark 2 | IMPLEMENTED_BUT_NOT_CONNECTED to orders | `src/lib/grid/spark-templates.ts`, `src/lib/intel/mirofish.ts` (`freshSparkCard`) | No | Context. The last local file was still "processing" |
| Alexandria | IMPLEMENTED_BUT_RESEARCH_ONLY | used as a source label in the intel path | No | A tool count is not a macro signal |
| MiroFish | IMPLEMENTED_BUT_NOT_CONNECTED | `src/lib/intel/mirofish.ts` (probe, step, read). Four surfaces: client, auth `src/lib/research/mirofish-auth.ts`, state file, UI | No | Last local read was an error: the swarm was down. A vote is not a win probability |
| Research Plus MCP | NOT_FOUND | no call to `https://research-plus.lovable.app/mcp` | No | None |
| Coinbase | IMPLEMENTED_AND_CONNECTED as public data | `src/lib/desk/market-data.ts` host `api.exchange.coinbase.com`. `src/lib/live/server.ts` reads BTC/ETH/SOL/XRP candles | No order transport found | Candles feed indicators. They do not place Coinbase orders |
| Pyth | IMPLEMENTED_AND_CONNECTED as a price feed | `src/routes/api/live/pyth`, `src/lib/skill/pyth-socket.server.ts` | No | Price input for gold and some crypto |
| CF Benchmarks | IMPLEMENTED_AND_CONNECTED as the BTC settlement index | desk RTI path, `data/rti-bars.json` | No | Used in the 15-minute settlement read |
| Polymarket | CONNECTOR_PRESENT_BUT_UNVERIFIED | venue name in `src/lib/scan/types.ts` | No funded order path verified | A scanner name is not an account |
| Solana / meme | CONNECTOR_PRESENT_BUT_UNVERIFIED | venue label in the envelope UI | No wallet send found | A price row is not a trade |
| Technical indicators | IMPLEMENTED_AND_CONNECTED | `src/lib/desk/indicators.ts`, sniper in `src/lib/desk/sniper.ts` | No | Perps score is 0–13. It does not approve a 15-minute order by itself |
| Probability / calibration | IMPLEMENTED_BUT_RESEARCH_ONLY | `settlement.ts`, `calibration.ts`, `prob-edge.ts` | Blocked | Perps win probability stays UNKNOWN until matched outcomes exist |
| Grok / Gemini | IMPLEMENTED_BUT_RESEARCH_ONLY | maker prompt in `src/lib/loop/maker.ts` | No | Paper maker. Not a live send |
| Dashboards | IMPLEMENTED_AND_CONNECTED | envelope UI | No | Display |
| Order adapters | LOCKED_EXECUTION | `src/lib/desk/oms.ts`, `src/lib/perps/order-adapter.ts` | Both locks on | A mock test is not a live route |

Spark 2 files that exist: `src/lib/grid/spark-templates.ts`, `freshSparkCard` in `src/lib/intel/mirofish.ts`, `data/spark-latest.json`, `scripts/perps/intel-trace.ts`.
MiroFish files that exist: `src/lib/intel/mirofish.ts`, `src/lib/research/mirofish-auth.ts`, `data/mirofish-latest.json`, `data/mirofish-state.json`.

## How a number becomes a decision

15-minute yes/no:

1. `settlement.ts` makes a probability from the index versus the strike.
2. `features.ts` can nudge that probability, but `FEATURE_MAX_SHIFT` in `config.ts` is **0**. The nudge is always zero.
3. `src/lib/grid/features.ts` has nine research features. Each is hard-coded `weight: 0`.
4. `approval.ts` then requires a calibrator file and positive after-cost EV. No calibrator, no order.
5. `oms.ts` also checks `CALIBRATED_MODEL_APPROVED`. That is false.

Perps:

1. `candidates.ts` scores the sniper. A trade needs data, a setup, funding, depth, size, a fresh book, an open market, and after-cost payoff.
2. The strict gate wants 9 of 13. A 4 or a 5 still loses.
3. `intel.ts` can add `intelScore × 0.25` in the ranker only. Default rank weight is 0 unless a caller passes 0.25. It does not change the stop or the size.
4. `prob-edge.ts` will not invent a win probability. Break-even is not a win rate.

Spark, Alexandria, Firecrawl, and MiroFish do not bypass either gate.

## One real research row

`data/mirofish-latest.json` (local, not git): headline about the September 2026 employment report, probability `null`, stage "MiroFish is not running", time `1791371509115`. That row was not available as a number before any decision. It did not change a candidate. It did not improve a result.

The last perps trace on an open book (Bitcoin and gold, 183 complete 15-minute bars) was `NO_TRADE`. Bitcoin short was a pullback at 4/13. Research was not applied as a probability. There is no Brier score. Sample of matched perps outcomes: 0.

## What is still missing

- Research Plus is not wired.
- Coinbase, Polymarket, and Solana do not have a checked live order path.
- The nine research features cannot move a probability until someone measures them and the owner turns the shift on.
- The book backup is still only on this machine.
- A live midnight rollover has not been watched. The code test covers it.

## Next coding task

On a short branch from `9b94dd3`: log one shadow row per scan that records the technical decision and the research rank side by side, using only files already on disk. Pass if a missing MiroFish or Spark value stays `UNKNOWN`, the order locks stay on, and the row says whether the rank would have differed. Do not send an order.
