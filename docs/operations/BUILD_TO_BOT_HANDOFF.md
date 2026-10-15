# Build to Bot handoff

This is a snapshot of the repo. It is not a strategy.

## Git

Checked against GitHub on 2026-10-15, after PR #3 merged.

- Repo: https://github.com/yougotsam/MacroMiro
- Canonical branch: `main`
- `main` SHA: `9b94dd38dc2bceba2c3c40790ba852a33142c8a9`
- That SHA is the merge of PR #3. It is not `a30d5a1`. Closing PR #3 now would not roll `main` back.
- The perps book work inside that merge ends at feature commit `0eb21f9182290ab983daeb1a1806b1f5f31664f8`.
- `fix/executable-perps-book` is a finished branch, not the place to start new work.
- This documentation lives on `audit/intelligence-map` as PR #4. Do not start a second docs PR for the same correction.
- Do not start new work from `fix/aurix-x` or `desk-brain-mirofish`.
- Before coding, Bot runs `git fetch origin` and `git rev-parse origin/main`. If that SHA is not `9b94dd3`, main moved. Read the new handoff. Do not trust this paragraph over the command.

## What is running

- This file is documentation. The trading code it describes is already on `main` at `9b94dd3`.
- No separate deploy SHA was checked. Do not assume a website is serving `9b94dd3` until that site is asked.
- Uncommitted files under `data/`, `attachments/`, and `artifacts/` are runtime notes. Do not commit them. Do not delete them.

## What the code does

- Kalshi 15-minute predictions stay as they are. Live model approval is off: `CALIBRATED_MODEL_APPROVED = false` in `src/lib/desk/config.ts`.
- Perps orders are locked: `PERPS_ORDERS_LOCKED = true` in `src/lib/perps/order-adapter.ts`.
- The perps selector is `src/lib/perps/candidates.ts`, schema `perps-candidate/v2`.
- `src/lib/scan/perp-desk.ts` does not send orders.
- Candle replay label must be exactly `CANDLE_ONLY_NOT_EXECUTABLE`. Older sim files are quarantined.
- Sizing: `aggressive-experimental/v1` in `src/lib/perps/mandate.ts` is PROPOSED, not approved. A candidate that does not name a profile uses `research-clip/not-a-mandate` ($1 risk, $100 notional). That clip is not the aggressive profile and not a live rule. The old conservative profile is `REJECTED_SUPERSEDED`.

## Intelligence

- Firecrawl, Spark 2, Alexandria, and MiroFish are still in the tree.
- They do not place orders.
- On 2026-10-15 the local MiroFish file was an error (process down) and Spark was still `processing`. Both research features are `UNKNOWN` until they have a value and a timestamp.
- A missing research file is not a reason to invent a probability.

## Data on disk

Root: `/workspace/data` (`MACROMIRO_DATA_DIR` overrides it in tests).

Second copy, checksum-verified on 2026-10-15, not in git:

- Location: `/workspace/backups/macromiro-2026-10-15/`
- 23 files, 23,664,551 bytes, every copy matches its source SHA-256.
- `data/perps/stream/2026-10-15/book.jsonl` — 15,377 lines, 2,594,656 bytes, `cad75b40f95991ee…`. The copy was parsed from the first line through the last line.
- `trades.jsonl` 46,945 bytes `4e9b3ab534c98498…`. `ticker.jsonl` 135,097 bytes `8ac9d7b1bc299350…`.
- Replaying the copy with `tradingActive: true` rebuilt Bitcoin `8.1253 / 8.1257` and gold `4.1537 / 4.1538`. With no exchange-status flag, those books are not marked executable.
- `data/ledger.jsonl` and collector status were copied too. They stay out of GitHub. The manifest is `backups/macromiro-2026-10-15/MANIFEST.json`.
- This backup lives only on this machine. It is not a second host.
- Owner copy, no purchase and no upload to GitHub: copy the folder `/workspace/backups/macromiro-2026-10-15/` onto a disk you control (a second computer or a USB drive). On that copy, hash each file and compare it to `sha256` in `MANIFEST.json`. All 23 rows must match. If one does not, the copy is bad. Do not commit the folder. Do not paste the files into a chat.

Also on the working disk, not a substitute for the backup:

- `data/heart.json`, `data/kill.json`, `data/mirofish-latest.json`, `data/spark-latest.json`

## Active-market check (2026-10-15)

- 08:35 UTC: `trading_active` was false (Thursday maintenance). 12 snapshots, 0 deltas.
- 09:01 UTC: `trading_active` was true. About 20 seconds added 15,353 deltas and 270 trades. Replay of `book.jsonl` matched the live top of book for BTC `8.1253 / 8.1257` and gold `4.1537 / 4.1538`.
- A replay with no timestamped `tradingActive: true` is not treated as an open market.
- A midnight seed writes the whole in-memory book and keeps a stale book stale. A depth-limited row cannot be called executable. A real UTC midnight has not been watched yet. The boundary is covered by a unit test, not by a live date change.
- A later trace, book fetched after the candle pull: BTC and gold each had 183 complete 15-minute bars (the old 57 was a 16-hour pull, not a broken parser). The 60-bar rule was not lowered. No side passed the gates. BTC short was `TREND_PULLBACK` at 4/13 and still `NO_TRADE`. Win probability `UNKNOWN`.

## Tests on this checkpoint

- `bun test`: 712 pass, 0 fail
- `tsc --noEmit`: pass
- `vite build`: pass (about 0.6s). `npm run build` also runs a database migrate; that step was not required to prove the bundle.
- eslint on the project: 0 errors, 61 warnings. The warnings are older unused names in other files, not in this checkpoint's diff.
- Orders stay locked. No live order was sent.
- Those checks were run on the code that is now inside `main` `9b94dd3`, before the merge. This documentation PR does not change that code.
- GitHub on `2dd9210`: Sourcery review SUCCESS. Later review notes on the book path were fixed before the merge. A live midnight rollover has still not been watched. That path is covered by a unit test.

## Docs to trust

1. `docs/product/PRD.md`
2. `docs/architecture/SYSTEM_MAP.md`
3. `docs/strategies/STRATEGY_REGISTRY.md`
4. `docs/strategies/EXECUTION_EVAL.md`
5. `docs/operations/RISK_MANDATES.md`
6. `docs/operations/RUNBOOK.md`
7. `AGENTS.project.md`
8. This file
9. `docs/operations/INTELLIGENCE_AUDIT.md` — what is connected
10. `docs/operations/PROBABILITY_MATRIX.md` — what each number means

If a chat disagrees with these files, the files win. The audit and the probability note must not contradict this handoff. `main` is `9b94dd3`. PR #3 is merged.

## Do not resume these

- Do not check out `fix/aurix-x` or `desk-brain-mirofish` to keep building.
- Do not open a second PR for this same work.
- Do not revive PR #2.
- Grok Build and Grok Bot must not edit this branch at the same time.

## Rollback

`main` already contains PR #3 at `9b94dd38dc2bceba2c3c40790ba852a33142c8a9`. Do not close PR #3 to undo it. Do not `reset` `main`. `a30d5a1` is the parent before that merge, not the current main. Rolling back would be a separate owner decision and is not requested.

## Next job

PR #3 is merged. Do not rebuild it.

After the owner merges this documentation PR, Bot starts from the new `origin/main` and reads this file plus the audit and the probability note.

First coding job, named SHADOW DECISION FUSION:

- One row per scan, from files already on disk.
- Fields: market, decision time, evidence that was actually available then, technical baseline, experimental research note, original rank versus revised rank, executable costs, and the outcome when it exists.
- A missing or late file stays UNKNOWN. Do not invent a MiroFish percent. Do not invent agent votes. Do not start a paid swarm or a paid scrape.
- A MiroFish report sentence is an uncalibrated claim. It is not a settlement probability and not a perps win probability.
- Compare market-only, technical-only, and research-added ranks on the same clocks. Brier score only when a real outcome exists. Net expectancy only on real fills.
- Both order locks stay on. The row must not be able to reach `approve()` or a perps send.

## Verdict

PR #3 is merged. This pull request only corrects the documents. Prediction approval stays off. Perps sending stays locked. No strategy numbers were changed in this PR. Win probability is still unknown. That is a fact, not a document bug.
