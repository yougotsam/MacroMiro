# Macro Miro perps: implementation bridge and safety inventory
**2026-11-20.** Canonical repository: \`yougotsam/MacroMiro\`, \`main\`. No new trading product, no live authorization, no archive deletion.

The supplied audit jumps from §1.6 to §8.1. Sections 1.7–8.0 here are a **reconstructed roadmap, not recovered verbatim text**. None of its numerical stop, leverage, Sharpe or hit-rate targets are owner-approved policy.

## Existing code map: reuse, do not duplicate

| Existing module | Reused for | Added this change | Still missing |
|---|---|---|---|
| \`src/lib/perps/kalshi-perps-read.ts\` and \`live-transport.ts\` | Margin REST read/transport | Official separated margin hosts; capability probe | Authenticated demo check and 72h monitoring |
| \`src/lib/desk/oms.ts\` | Actual signed HTTP write path | Correct perps host; event-contract path unchanged | Full consolidated authorization review |
| \`src/lib/perps/stream.ts\`, \`book-replay.ts\`, \`scripts/perps/collect.ts\` | Live book and historical replay | Receipt-time freshness; shared-subscription sequence gap tests | Normalized event adapter, subscribe interval/conflation tests, user fill socket |
| \`src/lib/perps/candidates.ts\` | Research scanner | Fail-closed unknown market/book state; signed after-cost candidate | Fee version per account, empirical maker fill odds, portfolio risk |
| \`src/lib/perps/sim.ts\` | Causal 1m-bar research | Crypto ET funding with DST; same fill P&L | Venue-derived noncrypto funding, realistic book replay/fill calibration |
| \`src/lib/perps/oms.ts\` | Existing idempotent order manager, journal, protection | Kill latch and retain protective stops until flat verified | Independent watchdog, out-of-band kill, continuous venue reconciliation |
| \`src/lib/perps/mandate.ts\` | Proposed risk-sizing experiments | No owner risk-policy modifications | Exact per-trade/daily/drawdown/portfolio limits must be approved |
| \`docs/operations/REPO_CLEANUP.md\` | Existing archival workflow | Left untouched | Durable private checksum archive before untracking any historical data |

## Reconstructed §1.7–§8.0

**1.7: Rate-limit and order uncertainty.** A 429 requires token-bucket backoff. A timeout or 5xx after an order send is UNKNOWN; reconcile by persisted client order ID, never blind resend. No in-flight state may become “failed” simply because the HTTP response is missing.

**2: Objective.** Evaluate after-cost return, drawdown, realized funding, fees, maker fill probability, adverse selection, position utilization and NO TRADE rejections. Win rate is context, not the objective. All numeric return/tail thresholds need measurements and operator signoff.

**3: Exposure and risk.** Treat portfolio/cross and isolated position types separately. Combine stop distance, potential gap, liquidation, account equity and correlated exposure. Unknown account state blocks new exposure. A dashboard percentage is not an exchange-enforced stop.

**4: Honest replay.** Replay the same signal, sizing, stop and cost logic used for shadow decisions. Purge overlapping labels at train/test boundaries; embargo, record tried parameters and hold out a final untouched period. Record effective sample size and dependence-aware uncertainty; no claims of confirmed profitability from proxy fills.

**5: Point-in-time macro intelligence.** A feature used at decision time must have an available-at timestamp at or before that decision. Keep economic revisions and final funding payments out of earlier decisions. Firecrawl, Spark and Alexandria research is supporting evidence, not an execution authorization.

**6: Versioned approval.** Every selected market, entry, exit, scale-in, risk, funding or macro rule needs an ID, version, provenance, test cases and state: RESEARCH, PROPOSED, OWNER_APPROVED or RETIRED. The operator approves each actual strategy rule separately; this engineering approval is not live-trading approval.

**7: Sizing and returns.** Use venue-derived quantities, fill-side prices, direction-signed P&L, per-fill fees, funding, tick/contract step sizes and liquidation distance. Do not double-charge spread and slippage. Kelly and aggressive sizing are deferred until measured and separately approved.

**8: Release.** One GitHub canonical version, Vercel website as UI only. A live worker, authenticated user WebSocket, exchange risk and margin, out-of-process kill, 72h demo record, fill/position reconciliation and separate live release are not established by a green website build.

## Exit gates for future phases

1. **Archive:** Private off-repo storage, SHA-256 manifest, restore test and clean checkout before any tracked data is untracked. Current 935-file audit is a baseline, not proof all files are junk.
2. **Data:** Complete typed margin event adapter, subscription-scoped gap recovery, market add/remove/interval conflation tests, snapshot warm-up and authenticated demo readiness.
3. **Costs:** Versioned account fee schedule, signed realized P&L, provisional vs finalized funding, accurate fill latency, and full ledger reconciliation against Kalshi fills.
4. **Order safety:** One authoritative authorization gate, out-of-band kill, independent heartbeat, no unknown-order resend, stop/target recovery, and true venue-position validation.
5. **Strategy:** Owner-approved entry/exit/size rules, first-class NO TRADE UI, walk-forward and untouched OOS analysis.
6. **Live:** Demo shadow parity, evidence-based limits and separate explicit owner release. **Live orders stay off.**

This iteration is a tested **foundation**, not the entire 40-test suite, complete strategy, archive or live system.

## Emergency-stop review branch · November 21

The HTTP entry route stays hard-locked. The independent watchdog runs on a persistent trading host. A Vercel website preview only exercises the website.

| Operator control | Behavior |
|---|---|
| Shared journal | Set `MACROMIRO_PERPS_JOURNAL` to the same existing journal on one local filesystem for both processes. Start from an accounted-for, dedicated desk. Incomplete history, foreign orders, or ambiguous positions halt reconciliation. |
| Reconciliation | The existing opt-in `scripts/perps/fill-guardian.ts` checks journal identities, venue orders, signed filled quantities, current positions and brackets each successful cycle. It writes the worker heartbeat only after those checks pass. On mismatch it persists the stop and emits a SEV1. |
| Independent watchdog | After the first healthy reconciliation, supervise `bun scripts/perps/watchdog.ts` in a separate process. It polls every second. A missing, invalid, or 15-second-old worker heartbeat latches the stop. These timings are engineering settings. |
| Operator halt | `bun scripts/perps/watchdog.ts --kill` sets a durable file latch immediately. Its default mode requires filesystem access only. It exits with status 2 on a halt. Read the alert file beside the journal (`.alerts.jsonl`) and route stderr to the supervisor. An optional HTTPS `MACROMIRO_PERPS_ALERT_WEBHOOK` receives a SEV1 with an idempotency key. A failed page can be retried by rerunning the watchdog. |
| Dedicated demo flatten | Only the explicit `--flatten-demo` option on a watchdog running with `KALSHI_PERPS_ENV=demo` can cancel orders and attempt a reduce-only demo flatten. It compares `PERPS_KILL_TOKEN` with the owner-only `PERPS_KILL_TOKEN_FILE`. Venue bulk cancellation is account-wide on this legacy path. Use only a dedicated demo account. Scoped lifecycle cleanup remains closed. |
| Unknown exposure | The stop drains admitted submissions and protective writes for up to five seconds before cancellation. An unresolved client ID, stale lease, incomplete read, or partial flatten returns UNKNOWN and leaves entries blocked. A successful flatten requires venue readback before clearing brackets. The file latch survives restarts. No command here rearms the desk. |

For a stranded lease, inspect the venue orders, fills, positions, triggers, owning process and journal before operator intervention. Never clear a lease based on its age. The next release gate is authenticated demo validation with continuous reconciliation, working operator alert delivery and a supervised runtime. Historical archives and owner risk parameters are separate workstreams.
