# Research runner reliability review — November 22, 2026

Scope: the existing MiroFish research runner and its local Alexandria archive. Base: canonical `main` at `87803f4` (PR #24 already merged). No strategy weights, trade gates, size controls, owner approvals or live flags change. No paid simulation was run for verification.

## Confirmed corrections

- Meter cumulative per-job ledger totals before/after steps, including failed calls, cancellation and deadline exits. Preserve the last known total if the meter fails, returns null or regresses. Mark the read unavailable using a fixed local error code. Do not add cumulative snapshots together.
- A billing failure or late overrun cannot prevent retrieval/archival of a completed report. Paid-operation admission checks run before new expensive requests; status reads and completed-report downloads remain possible.
- Persist `extract → archive` separately. Stage completed markdown with SHA-256, persist an archive receipt, then declare `done`. Resume uses the staged report and receipt without depending on a still-available backend. Archivers must deduplicate by `job.id`, including the commit-before-response crash window. The existing Archive already did ID deduplication; it now also writes reports/index atomically and serializes archive mutations.
- Pre-event reports expire at the event. Post-event reports expire at event +24h. Legacy pre-event TTLs are clamped when considered for reuse. Regeneration does not bypass the existing pre-event provenance rules: as-first-published inputs remain required, and post-event outcome work remains separate.
- Strip numeric claims from extracted narrative, retaining the untouched full report for review. This is defense in depth, not a new claim that text is safe to trade on. No text-to-trade connection is added.
- Bound interview-environment shutdown to three requests. Preserve a visible failure when shutdown is not confirmed. Do not start a simulation after a failed or ambiguous run-status read. Persist an uncertain start before dispatch; interrupted-start cleanup attempts remote shutdown, and an idle status alone never authorizes resending an uncertain start.
- Pin each new CLI job's cost assumptions to its recorded model version and price-assumption version. Refuse models absent from the existing price registry. These rates are repository assumptions, not newly verified billing prices. Re-estimate from backend `profiles_count` before starting, including the already-prepared recovery path. Unknown counts refuse start. Resolve the model from `MIROFISH_ENV_FILE` with the bundled backend's file-over-environment precedence, with inherited `LLM_MODEL_NAME` when no file supplies it. Status and cancellation remain available when that configuration is unreadable. A restarted CLI also refuses new paid work when its configured model version differs from the saved job.
- Reserve an aggregate catalyst budget across scenarios, seeds and attempts. Admission is serialized. Reservations retain the greater of estimate and known spend, including failed attempts, rather than silently releasing unknown costs. Increasing a new job's cap cannot override an existing lower catalyst cap. `--catalyst-budget` is explicit; absent it, the single-job budget is also the aggregate ceiling. This does not approve spending.
- Preserve `retries` as consecutive-step failures for compatibility and add `totalRetries`. Audit and throw on corrupt job/archive records. Persist the execution deadline across restarts. `--max-minutes` was already configurable; the default stays 90.
- Persist a separate monotonic cancel marker so stale worker snapshots cannot erase cancellation. Poll operator cancellation during in-flight transport requests and backoff. The transport combines cancellation with its request timeout. Aborting HTTP does not prove remote work was stopped. The CLI pauses its queue after a failed/cancelled job instead of immediately retagging late remote work as the next job. Inspect the backend and reconcile late meter entries before explicitly restarting the runner.

## Corrections to the outside review

1. `jobKey` already hashes catalyst ID, scenario, seed and prompt version. Four scenario names produce four keys. This is tested, not reimplemented as a parallel registry.
2. `ACTIVE_STAGES` already includes `archive`.
3. `Archive.add` already deduplicated IDs. The weak points were staging, receipts, crash boundaries and concurrent writes.
4. The actual condition was `env_alive === true`, not false. In the bundled Twitter runner, the IPC status becomes `alive` after rounds finish, while waiting for interviews. A false flag during active rounds is normal and must not trigger an early stop.
5. `parallel_profile_count: 3` is generation concurrency, not three agents. The actual population is `profiles_count`.
6. The official-document seeder and the discarded-result call in `scripts/intel-worker.ts` are separate paths. This patch does not claim the latter has been fixed.

## Methodology record — no behavior activation

Bullish/bearish prompts condition the scenario, so their returned lean cannot independently validate that same direction. The baseline and unexpected worlds also contain prompt assumptions. Cross-scenario disagreement is a candidate research feature, not proven information or edge simply because several synthetic worlds differ. Simulated agents may share model/source biases.

Existing lean/outcome comparisons are exploratory diagnostics and must not be presented as independent calibrated forecasts. Do not select the scenario that matched a known realized move and call that an ex-ante result. Define any disagreement feature before outcomes, preserve source availability and model/prompt versions, and test on held-out events with realistic trade economics. Multiple worlds of the same event are not independent market observations.

No narrative-direction input, time veto or size reduction is enabled. Even those proposed uses require separate owner approval and held-out evidence. The official-calendar rule remains separate. Alexandria historical-release research must retain the vintage available at decision time, not today's revision.

## Runtime and accounting boundary

Use one supervised persistent host and local filesystem for this worker, jobs, receipts and archive. A READY Vercel website is not that host. No host was provisioned by this patch.

`runner.pid`, `worker.lock`, `admission.lock` and `archive.lock` are exclusive files. Normal exits release them. After a crash, inspect owning processes, backend work and the meter tag before manually removing a stranded lock. Age alone is not recovery evidence. Existing records without a model-versioned cost basis cannot initiate new paid operations until explicitly reconciled. Completed-report recovery remains allowed. Expired jobs with an existing report ID or extract/archive stage get one persisted five-minute read-only recovery window; restarts do not renew it and no new paid request is allowed in it.

Meter totals are cumulative token-ledger dollar estimates, not a complete provider invoice. Firecrawl credits and Zep costs are not silently treated as measured dollars. Async remote work can finish billing after a failed/cancelled call; retain and reconcile its job tag. This patch records visible checkpoints and conservative reservations, not a provider-side hard spending guarantee.

Production blockers remain: select/supervise the persistent host, verify actual integrations and alert delivery, and resolve the embedded database asset issue recorded on PR #24 as the first demo-blocking follow-up. That unrelated database issue is not fixed by this runner patch. Do not start the 72-hour trading demo on the strength of these unit tests.

## Verification

- Full suite: 1,256 passed, 0 failed across 96 files, including 33 new runner regressions. Research subset: 71 passed. Typecheck and safe Vite build passed. Lint: 0 errors, 84 warnings, unchanged from the base.
- Test invocation: `FIRECRAWL_API_KEY=fc-test-no-network-credential bun test`. This is a nonfunctional fixture for existing Firecrawl tests whose requests are injected mocks. Without it, the same six missing-credential failures occur on both untouched `87803f4` (1,217 pass / 6 fail) and this branch (1,243 pass / 6 fail, before the final two regressions). With it the untouched base passes all 1,223 tests. No real service credential was supplied.
- Scenarios cover failed-stage metering, billing read failure, cumulative totals, late cost overrun, archive commit/receipt crash windows, corrupt records, event expiry, all four keys, aggregate reservations, actual agent counts, unknown start state, bounded shutdown, cancellation and durable deadlines. Existing research-isolation tests remain passing.
- Fake transports and local temporary stores establish code behavior. They do not establish actual MiroFish/provider billing, persistent-host supervision or real alert delivery.

- Built-preview startup reproduced the existing missing `_libs/pglite.data` asset before the browser could connect. The browser render check is blocked on that infrastructure issue; no fresh successful render is claimed for this patch. The Vercel branch deployment reported READY, which is not worker/runtime validation.

The automated review's three findings (interrupted start, expired extract recovery, configured model path) have focused reproductions and fixes. Remote stop acknowledgment remains unconfirmed without backend reconciliation; a cancelled local job is not proof remote work ended.
