# Build to Bot handoff

This is a snapshot of the repo. It is not a strategy.

## Git

- Repo: https://github.com/yougotsam/MacroMiro
- Canonical branch: `main`
- `main` SHA: `a30d5a1c652a1e6b7cde2a2f59a2958e84101744`
- Feature branch: `fix/executable-perps-book`
- Code parent before the release checkpoint: `2dd92102ef5975adfa27f3805c0c000bd784e15a`
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

Second copy, checksum-verified on 2026-10-15, not in git:

- Location: `/workspace/backups/macromiro-2026-10-15/`
- 23 files, 23,664,551 bytes, every copy matches its source SHA-256.
- `data/perps/stream/2026-10-15/book.jsonl` — 15,377 lines, 2,594,656 bytes, `cad75b40f95991ee…`. The copy was parsed from the first line through the last line.
- `trades.jsonl` 46,945 bytes `4e9b3ab534c98498…`. `ticker.jsonl` 135,097 bytes `8ac9d7b1bc299350…`.
- Replaying the copy with `tradingActive: true` rebuilt Bitcoin `8.1253 / 8.1257` and gold `4.1537 / 4.1538`. With no exchange-status flag, those books are not marked executable.
- `data/ledger.jsonl` and collector status were copied too. They stay out of GitHub. The manifest is `backups/macromiro-2026-10-15/MANIFEST.json`.
- This backup lives only on this machine. It is not a second host.

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
- GitHub on `2dd9210`: Sourcery review SUCCESS. Codex left five notes on that commit (book time, funding-from-fill, stale seed, rollover sequence, unreadable sim file). Those five are fixed in the checkpoint after `2dd9210`. Sourcery has not graded the new commit until it finishes on GitHub.

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

After the owner merges PR #3: keep `bun scripts/perps/collect.ts` running while the market is open. Build sniper candidates from that book. Compare the 5/13, 7/13, and 9/13 research gates on real outcomes. Do not invent fills. Do not turn on live orders. Do not spend research credits. Prediction limits stay separate from the proposed aggressive perps mandate.

## Verdict

Engineering checks that can be run here passed. PR #3 is ready for the owner to merge. It is not merged. A live midnight rollover has not been watched; that path is covered by a unit test. Win probability is still unknown, and that is not a merge blocker for this read-only infrastructure.
