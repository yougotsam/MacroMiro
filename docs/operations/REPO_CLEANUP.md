# Macro Miro cleanup and consolidation

**Audited:** November 11, 2026, from `main` commit `671fe1b`. This is a safety-first cleanup plan, not permission to delete trading evidence or switch on live orders.

## Reality check

- **935 Git-tracked files**. File count alone is not a sign of a broken application.
- `src/`: **389 files**, including source and automated tests. Keep until individual features have dependency and test coverage reviews.
- `mirofish/`: **122 files**, a separate bundled agent/subproject. Do not cherry-pick/delete its code while integrations still reference it.
- `.grok/`: **97 files**, Grok environment skills and references; avoid deleting generic instructions without confirming Grok's runtime/startup contract.
- `scripts/`: **93 files**, including data collectors, risk checks and backtests. Classify by actual usage, not a folder name.
- `data/`: **85 tracked files, about 164 MB**. **This is the first real source-control bloat target**, but most bytes are historical market/decision data.

### High-impact candidates for archival (NOT deletion yet)

| Example tracked file | Approx size | Initial classification |
|---|---:|---|
| `data/desk/prints/2026-10-21.jsonl` | 27 MB | Market print history; likely reproducible but check source and coverage |
| `data/ledger.jsonl` | 25 MB | Historical accounting/decision evidence; **preserve** |
| `data/desk/prints/2026-10-20.jsonl` | 22 MB | Market print history; preserve until verified archive |
| `data/perps/cache/KXETHPERP-1-145d.json` | 14 MB | Historical replay cache; retain accessible for tests |
| `data/perps/cache/KXBTCPERP-1-145d.json` | 14 MB | Historical replay cache; retain accessible for tests |
| `data/perps/cache/KXXRPPERP-1-145d.json` | 13 MB | Historical replay cache; retain accessible for tests |
| `data/perps/cache/KXSOLPERP-1-145d.json` | 13 MB | Historical replay cache; retain accessible for tests |
| `data/desk/book-90s.jsonl` | 11 MB | Research market-book observations; preserve |
| `data/desk/decisions.jsonl.gz` | 9 MB | Archived decision evidence; preserve |

Sizes are from the checked-out repository, rounded. Small fixture data, calibration models, settlement rules and tests are NOT candidates for bulk removal.

## Built-in safe inventory and backup

The repository now includes a non-destructive tool. It lists the tracked dataset and largest files without deleting anything:

```bash
node scripts/ops/archive-tracked-data.mjs --plan
```

When a trusted, private, durable storage location is available, archive the dataset **outside** the project and verify every SHA-256 copy:

```bash
node scripts/ops/archive-tracked-data.mjs --archive=/absolute/private/storage/unique-macromiro-backup
```

Archive mode refuses an existing destination or a path inside Git. It does **not** remove or untrack source files, and does not rewrite history. Restore checks and separate approval to untrack are still required.

## Cleanup stages

1. **Stabilize the code.** Fix the one outdated regression assertion while proving the perps HTTP route stays locked and there is only one credential-bearing Kalshi POST signer. Run all tests.
2. **Classify file ownership.** Every source, test, generated artifact and third-party subproject gets a KEEP, ARCHIVE, REGENERATE or REVIEW decision. Do not make filename-based guesses.
3. **Stop new bloat.** `.gitignore` excludes future worker caches and logs. Ignore rules do **not** remove already tracked files.
4. **Archive first.** Copy candidate historical datasets and journals to a durable, access-controlled storage destination with a manifest containing full path, byte count, SHA-256 and origin, then verify checksum and retrieval. Never store signing credentials in the archive.
5. **Untrack the archived generated files** on a separate, reviewable PR using `git rm --cached`. This removes a file from version control, not the current working directory. Test a clean checkout **without** the data and confirm the app handles absent caches gracefully. Git history is not a durable substitute for that external archive.
6. **No history rewrite or force-push by default.** Removing a file in a new commit does not erase old Git blobs. History pruning would disrupt existing branches/collaborators and needs a separate decision.
7. **Only then prune unused code.** Use import/call-site analysis and full tests for each group of abandoned experiments, duplicate docs, mock scaffolds and optional subprojects. Delete in small reversible batches; prefer archiving one whole obsolete subsystem rather than stripping files at random.

## Strategy and risk changes are separate

- **Strategy:** HTF market structure; trend versus range; liquidity sweeps; CHoCH/BOS; FVG/OB; volume/VWAP and candle confirmation; scheduled macro news; funding; order-book depth and fees. Correlated indicators must not be counted as independent evidence.
- **Prediction:** Binary 15-minute YES settlement odds differ from perps target-before-stop odds. Score independently and compare after-cost expectancy. Estimated or hypothetical probability must be labeled as such.
- **Execution:** A trade decision can never override authenticated owner approval, true account position/equity, stop/target recovery, emergency reduce-only exits or the exchange's own rules.
- **Testing without money:** Test build and regression, replay historical bars, apply realistic spread/slippage/fees and use separated time windows. No funded live trading is required to discover strategy failures. Past tests do not establish future profitability.

## Release discipline

GitHub `main` = canonical code; one repair PR at a time. Vercel = deployment/review surface. Continuous workers need an explicitly managed runtime with durable data and restart handling. Do not operate independent Grok, ChatGPT and Vercel copies of the strategy. No orders are executed as part of this cleanup.
