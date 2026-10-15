# Build to Bot handoff

This is a snapshot of the repo. It is not a strategy.

## Git

- Repo: https://github.com/yougotsam/MacroMiro
- Canonical branch: `main`
- `main` SHA: `a30d5a1c652a1e6b7cde2a2f59a2958e84101744`
- Feature branch: `fix/executable-perps-book`
- Code parent before this file: `3643d70c810ec7fb0a4b0d8ac1582f7025015e86`
- Open PR: https://github.com/yougotsam/MacroMiro/pull/3
- Do not merge PR #3 unless the owner says so.
- The tip SHA is whatever `git rev-parse HEAD` prints on `fix/executable-perps-book` after this file is committed. Trust that command, not an old chat.

## What is running

- This checkout is the feature branch. It is not a published deploy.
- No deployed SHA was verified. `main` on GitHub is still `a30d5a1`.
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

- `data/perps/stream/YYYY-MM-DD/book.jsonl` — snapshots, deltas, gaps, reconnects. Not in git.
- `data/perps/stream/YYYY-MM-DD/trades.jsonl` and `ticker.jsonl`
- `data/perps/collector-status.json`
- `data/perps/trace-*.json`
- `data/heart.json`, `data/kill.json`, `data/ledger.jsonl`
- `data/mirofish-latest.json`, `data/spark-latest.json`

There is no second backup of these files in git. Copy the `data/perps/stream` folder yourself if you need a backup. Do not put keys or account balances in git.

## Active-market check (2026-10-15)

- 08:35 UTC: `trading_active` was false (Thursday maintenance). 12 snapshots, 0 deltas.
- 09:01 UTC: `trading_active` was true. About 20 seconds added 15,353 deltas and 270 trades. Replay of `book.jsonl` matched the live top of book for BTC `8.1253 / 8.1257` and gold `4.1537 / 4.1538`.
- The combined file counted 1 sequence seam between the maintenance capture and the open capture. The live session itself reported 0 gaps. Replay refuses a delta that skips a sequence.
- A later trace, book fetched after the candle pull: BTC and gold each had 183 complete 15-minute bars (the old 57 was a 16-hour pull, not a broken parser). The 60-bar rule was not lowered. No side passed the gates. BTC short was `TREND_PULLBACK` at 4/13 and still `NO_TRADE`. Win probability `UNKNOWN`.

## Tests on this checkpoint

- `bun test`: 712 pass, 0 fail
- `tsc --noEmit`: pass
- eslint on the touched files: pass
- Orders stay locked. No live order was sent.

## Docs to trust

1. `docs/product/PRD.md`
2. `docs/architecture/SYSTEM_MAP.md`
3. `docs/strategies/STRATEGY_REGISTRY.md`
4. `docs/strategies/EXECUTION_EVAL.md`
5. `docs/operations/RISK_MANDATES.md`
6. `docs/operations/RUNBOOK.md`
7. `AGENTS.project.md`
8. This file

If a chat disagrees with these files, the files win.

## Do not resume these

- Do not check out `fix/aurix-x` or `desk-brain-mirofish` to keep building.
- Do not open a second PR for this same work.
- Do not revive PR #2.
- Grok Build and Grok Bot must not edit this branch at the same time.

## Rollback

`main` has not moved. To abandon the feature branch, close PR #3. Do not `reset` `main`. The last safe main commit is `a30d5a1c652a1e6b7cde2a2f59a2958e84101744`.

## Next job

Keep `bun scripts/perps/collect.ts` running while trading is active so the book file grows. Do not turn on live orders. Do not spend research credits. The owner has to say "merge" before PR #3 lands.

## Verdict

Not merge-ready until the owner reads this and says so. The book path works on a live market. There is still no qualifying sniper trade and no measured win probability.
