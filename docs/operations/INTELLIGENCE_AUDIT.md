# Intelligence audit (after PR #3)

Main: `9b94dd38dc2bceba2c3c40790ba852a33142c8a9` (PR #3 is merged).
Read with `docs/operations/PROBABILITY_MATRIX.md`. This file says what is connected. That file says what each number means. They must not disagree.

This is an inventory. It does not turn research into a live order.

## What survived

`fix/aurix-x` and `desk-brain-mirofish` are old lines already inside `main`. Do not code on them. PR #3 added the perps book path. It did not delete the 15-minute desk. `fix/executable-perps-book` is finished.

## Capability matrix

| Piece | State | Where | Can it send an order? | Does it change a decision today? |
|---|---|---|---|---|
| Kalshi 15-minute predictions | IMPLEMENTED_AND_CONNECTED | `src/lib/desk/evaluator.ts`, `settlement.ts`, `approval.ts`, `oms.ts` | LOCKED. `CALIBRATED_MODEL_APPROVED` is false | Settlement math runs. Approval refuses without a calibrator |
| Kalshi pair / 15-minute books | IMPLEMENTED_AND_CONNECTED as reads | `src/lib/scan/kalshi.ts` | No | Prices and books. Not a send |
| Kalshi perps | IMPLEMENTED_AND_CONNECTED as research | `src/lib/perps/candidates.ts`, `book-replay.ts`, `scripts/perps/collect.ts` | LOCKED. `PERPS_ORDERS_LOCKED` is true | Sniper gates can say NO_TRADE. They cannot send |
| Official macro calendar | IMPLEMENTED_AND_CONNECTED to the sniper point | `src/lib/perps/intel.ts` → `macroClear` → `evaluateSniper` in `src/lib/desk/sniper.ts` | No | Yes, one point. A clear calendar can add the macro point toward 9 of 13. A blocked or missing calendar does not. This is not a news score |
| Firecrawl | IMPLEMENTED_BUT_RESEARCH_ONLY | The JSONL is read by `scripts/perps/intel-trace.ts`. `src/lib/perps/intel.ts` only receives the rows it is given | No | Not in the live selector. The 0.25 rank weight is used by that diagnostic script, not by `buildPerpsCandidate` |
| Spark 2 | IMPLEMENTED_BUT_NOT_CONNECTED to orders | `src/lib/grid/spark-templates.ts`, `freshSparkCard` in `src/lib/intel/mirofish.ts` | No | Context. Last local file was still "processing". An AI card is not an official release |
| Alexandria | IMPLEMENTED_BUT_RESEARCH_ONLY | source label and tool list in the intel files | No | A count of tools is not a macro surprise |
| MiroFish | IMPLEMENTED_BUT_NOT_CONNECTED to orders | `src/lib/intel/mirofish.ts`, `src/lib/research/mirofish-auth.ts`, swarm routes, UI | No | Scenario simulator. See the probability note. Score in `perps/intel.ts` is hardcoded 0 |
| Research+ | ASSISTANT_ONLY | Connect page `https://research-plus.lovable.app/connect` serves `https://research-plus.lovable.app/mcp` | No | Not imported anywhere in this repo. It searches papers and checks claims. A catalog search for CPI/FOMC/CFTC structured data returned no tool. Do not make the desk depend on it |
| Coinbase | IMPLEMENTED_AND_CONNECTED as public candles | `src/lib/desk/market-data.ts`, `src/lib/live/server.ts` | No order transport found | BTC, ETH, SOL, XRP candles for indicators |
| Pyth | IMPLEMENTED_AND_CONNECTED for gold only | `src/lib/skill/pyth-socket.server.ts` subscribes to `Metal.Index.1OZGOLD/USD` | No | Gold price. Not crypto |
| CF Benchmarks | IMPLEMENTED_AND_CONNECTED as crypto settlement indexes | `src/lib/skill/brti-socket.server.ts`: BRTI, ETHUSD_RTI, SOLUSD_RTI, XRPUSD_RTI | No | 15-minute crypto settlement reads. Not gold |
| Polymarket | IMPLEMENTED read-only connector | `src/lib/scan/server.ts` loads markets and `loadPolyUs()` in `src/lib/scan/polyus.ts`. `/api/live/pmus` is an account probe | No send found | A market list is not a funded trade |
| Solana / meme | IMPLEMENTED read-only tape | `loadDexTape()` in `src/lib/scan/dex.ts` | No wallet send found | A price tape is not a trade |
| Technical score | IMPLEMENTED_AND_CONNECTED | `src/lib/desk/indicators.ts`, `src/lib/desk/sniper.ts` | No | 0–13 points. Not a probability. It cannot approve a 15-minute order by itself |
| 15-minute probability | IMPLEMENTED, approval locked | `src/lib/desk/settlement.ts`, `calibration.ts` | Blocked | Index versus strike. The technical nudge cap `FEATURE_MAX_SHIFT` is 0, and that cap belongs only to `src/lib/desk/features.ts` |
| Perps win probability | NOT a model | `src/lib/perps/prob-edge.ts` | Blocked | Scores rows it is given and still labels `modelProbability: "UNKNOWN"`. It does not estimate a win chance |
| Nine research features | IMPLEMENTED_BUT_RESEARCH_ONLY | `src/lib/grid/features.ts` | No | Each weight is hardcoded 0. They are not `FEATURE_MAX_SHIFT` and they do not touch settlement |
| Grok / Gemini | IMPLEMENTED_BUT_RESEARCH_ONLY | `src/lib/loop/maker.ts` | No | Paper notes. Not a send |
| Dashboards | IMPLEMENTED_AND_CONNECTED | envelope UI | No | Display |
| Order adapters | LOCKED_EXECUTION | `src/lib/desk/oms.ts`, `src/lib/perps/order-adapter.ts` | Both locks on | A mock test is not a live route |

## How a number becomes a decision

15-minute yes/no:

1. `settlement.ts` makes a probability from the index versus the strike. Its only inputs are the prints, the strike, and volatility.
2. `src/lib/desk/features.ts` could nudge that probability. `FEATURE_MAX_SHIFT` is 0, so the nudge is zero. Those four groups are technical. They are not the nine research features.
3. `approval.ts` requires a calibrator and positive after-cost EV. No calibrator, no order. It takes no research argument.
4. `oms.ts` also checks `CALIBRATED_MODEL_APPROVED`. That is false.
5. A test forbids the order path from importing MiroFish, Spark, Firecrawl, or Alexandria.

Perps:

1. `candidates.ts` scores the sniper. Needs data, a setup, funding, depth, size, a fresh book, an open market, and after-cost payoff.
2. The strict gate wants 9 of 13. The official calendar can add one macro point through `macroClear`. Spark, Firecrawl, Alexandria, and MiroFish cannot.
3. `intel.ts` can build an `intelScore`. The live selector does not pass the 0.25 weight into the rank. The diagnostic `scripts/perps/intel-trace.ts` does. Neither path changes the stop or the size. MiroFish's own row score is 0.
4. `prob-edge.ts` does not estimate a win probability. Break-even is a cost identity. `modelProbability` stays `"UNKNOWN"` even if someone passes outcome rows.

## What MiroFish is, and is not

Kept. Not a calibrated chance that gold or bitcoin goes up.

`probabilityFromReport()` keeps a labeled report sentence (`Probability:` or `概率`) and nothing else. Upstream `report_agent.py` writes a story. It does not count agent votes. OASIS (arXiv 2411.11581) studies herd behavior, not a Brier score. A public October 2026 swarm run moved more when the seed wording changed than when the model changed. Those markets were not settled when this note was written, so that run is not a scorecard.

Our code then drops the number before any order context. `usableForSettlement` is the value `false`. Do not invent votes for old runs. Do not start a paid simulation from this audit.

## One real research row

`data/mirofish-latest.json` is local and not in git. Headline on the September 2026 employment report, probability `null`, stage that MiroFish was not running. It changed no candidate.

The last perps trace (Bitcoin and gold, 183 complete 15-minute bars) was `NO_TRADE`. Bitcoin short was a pullback at 4/13. No matched perps outcomes. No Brier score.

## What is still missing

- A shadow row that stores the technical rank and the research note side by side, with UNKNOWN when a file is missing or late.
- Research+ inside the trading process. Leave it on the assistant. Do not add a desk dependency for it.
- Coinbase, Polymarket, and Solana order sending. The readers above are not that.
- A second copy of the book backup on a disk that is not this machine. See the handoff.
- A live midnight rollover. The unit test covers the boundary.

## Next coding task

SHADOW DECISION FUSION, after this documentation PR is merged, from the new `origin/main`.

One row: market, decision time, evidence available at that time, technical baseline, experimental research note, original versus revised rank, executable costs, later outcome. Missing evidence stays UNKNOWN. A report sentence is not fed into settlement or into a perps win probability. Locks stay on. No paid Firecrawl scrape and no new MiroFish run unless the owner says so.
