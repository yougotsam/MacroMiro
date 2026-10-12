# MacroMiro — Autonomous Opportunity Hunter
**Canonical PRD draft v0.1 | 2026-10-12 | For Grok implementation**

## Mission
Build an experimental, aggressive, autonomous trading opportunity selector that identifies evidence-based, executable long/short or event-contract trades across authorized venues. Goal: after-cost realized net profit. Do not imply a guaranteed edge. Retain and reuse the substantial existing MacroMiro code; no new repository and no premature code deletion.

**Existing baseline:** `yougotsam/MacroMiro`, branch `fix/aurix-x`, PR #2. Grok must check real HEAD and working tree rather than assume a commit. Main trading venue for next adapter: Kalshi perpetuals; existing Kalshi 15-minute YES/NO event-contract engine remains operational as an independent strategy.

## Opportunity universe
1. **Perpetual futures:** Scan account-enabled Kalshi crypto (BTC, ETH, SOL, XRP and eligible DOGE/SHIB etc.), commodities (GOLD and SILVER first; others if live), and indices (US500 where available). GOLD is first-class; do not build a crypto-only adapter. Query real API market metadata, fees, contract multipliers, leverage limits, liquidity, funding and operating hours; never hardcode an outdated 29-market count.
2. **Kalshi 15-minute YES/NO:** Retain the existing code, collector, probability model, settlement verification, paper results and historical records. Rank it fairly against other available opportunities instead of assuming it always trades.
3. **Coinbase:** Reuse its real candle, trade and signed-volume sources. Preserve spot/meme-coin and eligible derivative route as future adapters; authenticated read-only access does not mean derivative trading is enabled.
4. **Future opportunities:** Additional venues and, separately, Whatnot commerce may be assessed after the first functioning conventional scalp adapter. These must not share a trading wallet or access keys.

## Architecture
```
Per-venue market data + explicit source timestamps
  -> technical/ICT features (BOS, MSS, sweeps, FVG, OB, EMA, VWAP,
     RSI, MACD, ATR, RVOL, real CVD only with valid signed flow)
  -> per-strategy candidate engines:
       PERPS_SCALPER / KALSHI_15M_BINARY / future adapters
  -> opportunity selector: liquidity, time, maker/taker fill probability,
     spread, funding, slippage, after-cost expectation, confidence
  -> venue-specific risk mandate and exchange-aware OMS
  -> ongoing stop/target/exposure/reconciliation worker
  -> realized P&L, walk-forward research and model/strategy feedback
```
Keep a unified versioned candidate schema recording venue, instrument, long/short or YES/NO, observation and decision timestamps, available bid/ask/depth, planned order type, stop/target, fees/funding/slippage, expected net value, setup evidence, calibrated/experimental status and subsequent outcome. **The old binary settlement-probability model must NOT be copied into perps.** Perps need their own assessed return/exit/fill probabilities.

Use existing Firecrawl, Spark 2, Alexandria, MiroFish, macro calendar, and Research+ as shared timestamped research sources. No general news scraping with no path to a tested decision feature. Any AI agent narrative stays distinct from verified facts; simulation does not directly authorize an order.

## Aggressive strategy and risk
Research fast 1m/5m/15m sniper entries; maker and taker routes, entry timing, tightly defined invalidations, active stops, partial take-profit and breakeven/trailing exits. Include gold, crypto and indices where market microstructure and account access make sense. Do not infer positive edge from low maker fees: model queue/no-fill, adverse selection, order latency, spread and funding.

**Prediction-contract approved policy:** daily stop -$15; total event exposure $9; $3/ticker; $4 correlated same-direction crypto. Maintain exactly until operator changes it.

**Leveraged perps policy:** Unapproved. Must be proposed separately with maximum position notional, collateral at risk, leverage per asset, maximum daily loss, risk per trade, stop/liquidation buffer, correlations, handling exchange outages and negative-equity obligations. The user's acceptance of losing an experimental allocation is NOT blanket authority for unlimited leverage or obligation beyond collateral. No production order until explicit venue-specific mandate and live authorization.

## Fundability and hosting blockers
Grok reports production `/margin/enabled: true` but a zero perps balance. Kalshi API documentation says its **API intra-account transfer endpoint** is not yet available, while Kalshi Help documents **direct deposits and transfers using the UI**. Verify what the actual authenticated user-facing account permits in a read-only observation; distinguish *API not supported* from *funding not possible*. Never submit a deposit or transfer without approval.

Grok Bot's cloud computer reportedly sleeps between turns. Development hosting is not guaranteed runtime hosting. Assess persistent service options and produce an exact quoted proposal before buying a VPS. Phase 2A read-only data feed and paper simulation can be developed before a final server purchase; live unattended position management needs a proven continuous worker.

## Modes
FULL_STANDBY = no new paid research; verify remote monitors off; independently label any collector still running.
OBSERVE = read-only exchange feeds, no orders.
PAPER = real quotes, simulated entries/exits, no real order actions.
LIMITED_LIVE = separate operator activation after strategy/OMS tests and perps risk mandate.

Only authenticated operators may change global modes, transfers, approved budgets or execution.

## Phased plan
**Phase 2A (next, no live orders):** Audit repo/docs and permissions. Discover live perps instruments with BTC/ETH/GOLD explicitly included. Connect authenticated read-only Kalshi margin REST+WS: order book, trades, market/mark/reference price, funding, fee tiers and status. Use correct millisecond timestamps. Reuse valid technical indicators and produce a genuine market snapshot -> signal -> long/short candidate -> cost-aware entry/stop/target -> NO_TRADE/RESEARCH candidate trace. Preserve original Kalshi collector and data.

**Phase 2B:** Paper maker/taker execution model with queue/fill/no-fill, realistic book depth, fees, funding and partial fills; verify native stop/TP semantics on demo if supported. Reconcile positions and persistence through process restarts. Compare market/family/regime-specific setups and baseline net results.

**Phase 2C:** Only after operator-approved leveraged limits and actual exchange-order reconciliation tests, request separate limited live activation. No arbitrary requirement for months of paper trading, but no fictional profitability claims.

## Documentation cleanup (one source of truth)
First list existing root and `docs/**/*.md` files, their owners, contradictions and broken references. Check `AGENTS.md`, `AGENTS.project.md`, `HANDOFF.md`, `docs/STRATEGY.md`, launch guides, old release reports and change cards. **Do not overwrite current working policies blindly.** Update existing canonical docs where possible and archive superseded ones; retain Git history.

Suggested canonical files if nonduplicative:
- `docs/product/PRD.md` — mission, venue scope, milestone/acceptance criteria
- `docs/architecture/SYSTEM_MAP.md` — actual code modules and data flow
- `docs/strategies/STRATEGY_REGISTRY.md` — each strategy's version, inputs, result, state
- `docs/venues/VENUE_MATRIX.md` — verified eligibility, fees, funding route, markets
- `docs/operations/RUNBOOK.md` — operating modes, services, on/off, credentials/hosting
- `docs/operations/RISK_MANDATES.md` — event-contract approved limits vs unapproved perps proposal
- `docs/decisions/ADR-001-OPPORTUNITY-HUNTER.md` — reason for expanding Kalshi-only mission
- root `AGENTS.md` — concise pointers to canonical rules/test commands

Archive deprecated documents rather than erasing data and tests; remove obsolete code only after new adapters run and references/tests pass.

## Acceptance and immediate Grok deliverables
1. HEAD, Git status, conflicting-doc registry, code component map and new canonical PRD/ADR in PR #2.
2. Authenticated account-specific confirmation of perps fundability or `NEEDS_OWNER_UI_CHECK`, with no funds moved.
3. Market scope including GOLD and crypto; exact real contracts, fees, mark/funding, trade-unit specifications, current liquidity and account access (no invented market support).
4. One complete **real read-only perps candidate** traced from live order-book snapshot to directional setup and net trade evaluation, even if decision is NO_TRADE.
5. Separate perps risk-mandate draft for owner input, not a hard-coded account balance.
6. Prioritized existing Codex findings (order-exposure reservation, malformed risk journals, feed first-tick stalls, unauthenticated mode mutation, research credit reservations). Fix only clear critical bugs while planning; don't claim all findings repaired.
7. `bun test`, typecheck, lint, build, secret scan; measured results, PR commit hash, screenshots if useful and a concise next implementation task.

**Hard boundaries:** Do not start real trades, deposits, transfers, hosting purchases, paid recurring research, or a fresh repository; don't merge PR #2 or delete historical trading data. These are distinct operator approvals.

## Official sources reviewed (Oct 12, 2026)
- https://docs.kalshi.com/margin
- https://help.kalshi.com/en/articles/15357664-depositing-transferring-withdrawing
- https://help.kalshi.com/en/articles/15357566-what-perpetuals-are-available-on-kalshi
- https://kalshi.com/fee-schedule?product=perps
- https://kalshi.com/pro/updates/perpetuals-gold-silver
- https://docs.cdp.coinbase.com/advanced-trade/docs/ws-overview/
- https://github.com/yougotsam/MacroMiro/pull/2
