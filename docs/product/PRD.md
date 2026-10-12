# MacroMiro: Autonomous Opportunity Hunter. PRD (canonical)
Version 0.2, 2026-10-12. Source: Sameer's PRD draft v0.1 (verbatim in `PRD-v0.1-source.md`). This file is the single product spec. Related docs: [SYSTEM_MAP](../architecture/SYSTEM_MAP.md), [STRATEGY_REGISTRY](../strategies/STRATEGY_REGISTRY.md), [VENUE_MATRIX](../venues/VENUE_MATRIX.md), [RISK_MANDATES](../operations/RISK_MANDATES.md), [RUNBOOK](../operations/RUNBOOK.md), [ADR-001](../decisions/ADR-001-OPPORTUNITY-HUNTER.md).

## Mission
An experimental, aggressive, autonomous selector of executable long/short and event-contract trades across authorized venues. The goal is after-cost realized net profit. There is no claim of a guaranteed edge. We reuse the existing code, do not create a new repo, and do not delete code early.

## Universe (priority)
1. **Kalshi perps**: crypto (BTC, ETH, SOL, XRP, DOGE, SHIB and others), metals (**GOLD first-class**, SILVER, then platinum, palladium, copper, aluminum), indices (US500). Read the live list from the API; never hardcode it.
2. **Kalshi 15m YES/NO** (existing engine). It is kept as a competing strategy and ranked fairly.
3. **Coinbase**: data source now (candles, trades, signed flow). Spot and derivatives are future adapters. Read access does not equal trading permission.
4. **Later venues** (Hyperliquid, Polymarket for research, Whatnot commerce). Separate wallets and keys, after the first working scalp adapter.

## Pipeline
Venue data with source timestamps → features (BOS/MSS, sweeps, FVG, OB, EMA, VWAP, RSI, MACD, ATR, RVOL; CVD only with valid signed flow) → strategy candidate engines (`PERPS_SCALPER`, `KALSHI_15M_BINARY`, `KALSHI_PAIR_UNDER_1`) → selector (liquidity, time, maker fill probability, spread, funding, slippage, after-cost expectancy, confidence) → venue risk mandate + OMS → exit/reconcile worker → realized P&L → walk-forward feedback.

There is one versioned candidate schema per venue (`perps-candidate/v1` in `src/lib/perps/candidates.ts`; `paper/candidates.ts` for Kalshi 15m). **The binary settlement-probability model is never reused for perps.**

## Research blend (from the X digest; each item must earn its place with measured value)
- Maker-only entries with a book-depth gate. Funding/OI crowding filter (short only when longs pay, and the reverse).
- Kalshi YES+NO pair scanner: buy both sides only when total cost + fees < $1 (read-only first).
- A fixed-question AI layer (typed take/skip/size questions; Grok structured output now, Jev optional). The AI never places orders.
- Brier scorecard per setup. Purged/embargoed walk-forward and deflated Sharpe before any promotion.
- Quarter-Kelly sizing under hard caps. Kill switch, with every risk rejection logged with its rule.
- Partial take-profit, breakeven and trailing exits (native Kalshi perps triggers).

## Modes
FULL_STANDBY (no paid research; collectors labelled separately) · OBSERVE (read-only feeds) · PAPER (real quotes, simulated fills) · LIMITED_LIVE (separate operator activation after the mandate and the safety checklist pass). Only an authenticated operator can change modes, transfers, budgets or execution.

## Phases and acceptance
- **2A (this PR):** a read-only perps adapter (metadata, books, trades, candles, mark/reference, funding, status, fees, price bands) and the perps candidate engine. One real trace. The order adapter is LOCKED OFF. **Done 2026-10-12** (see STRATEGY_REGISTRY).
- **2B:** paper maker/taker simulator (queue position, no-fill, partial fills, funding). A persistent perps collector on an always-on worker. Restart-safe reconciliation design. Pair scanner. Brier scorecard.
- **2C:** owner-approved perps mandate, demo-order/kill-switch tests, then a request for LIMITED_LIVE.

## Hard boundaries
No real orders, deposits, transfers, hosting purchases, recurring paid research, new repo or merge without a separate explicit owner approval. Never delete historical trading data.
