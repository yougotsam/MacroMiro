---
name: macromiro-sniper
description: Audit and evolve Macro Miro's Kalshi 15-minute and perpetual trade selection without equating research scores with validated probabilities or bypassing real exchange protections.
---

# Macro Miro sniper engineering

## Mission
Maximize after-cost realized expectancy, not trade count, raw win rate, or a visually impressive confluence score. This is the existing MacroMiro repository. Preserve both distinct engines: Kalshi 15-minute binary settlement and Kalshi margin perpetual target-before-stop. Never apply one product's probability to the other.

## Evidence hierarchy
1. Exchange orders, fill receipts, official market rules and settlement results.
2. Venue order books with receive timestamps, official funding, official release actual/consensus with availability timestamps.
3. Closed-bar technical structure: HTF direction, sweep, displacement, BOS/ChoCH, order block/FVG, ATR stop, VWAP, volume, candle confirmation.
4. Firecrawl/Spark/Alexandria provenance: raw primary source URL, published/received/decision timestamps, asset, event, surprise, freshness and independently measured predictive value.
5. MiroFish scenario narratives: research hypothesis only until enough separate, timestamped events pass holdout validation.

## Non-negotiable engineering contracts
- Quote freshness, venue depth, mark/liquidation, funding, maker fill probability, fees, slippage, and correlation risk have distinct fields. Unknown is null, never zero or true.
- A 13-point setup score is *not* 13 votes and cannot be converted into a win probability. Correlated indicators must not be double-counted.
- Perps use P(target before stop | order actually filled); binary markets use P(exact contract settlement YES). Measure proper scoring rules against out-of-sample outcomes; compare to a contemporary market-price baseline.
- Separate RESEARCH_PRIORITY, PAPER_ONLY, MODEL_QUALIFIED, and LIVE_EXECUTION_APPROVED. Only the last permits a trade, after a separate server-owned balance/risk, operator policy, watchdog, exchange readiness and protective-exit gate.
- Prefer embargoed walk-forward by calendar time, after-execution costs, reliability curves, confidence bounds, sensitivity to bid/ask and partial fills. Penalize overfitting/multiple trials.
- Never promote a narrative model's confidence or an unsourced 'high probability' claim.
- Only signed, versioned, timestamped feed inputs can affect model features. News unavailable means missing, not a favorable forecast.
- Every entry must have a durable venue-fill reconciliation worker and exchange-confirmed stop before claiming protected. Failed protection blocks new entries and alerts; risk-reducing exits must remain available.
- No live orders, credential extraction, production deployment, or deposit as part of a code/research audit.

## Implementation order
Read latest main, compare the feature branch, follow the complete order path and risk profile. Confirm current Kalshi REST/WS contracts and Vercel configuration. Implement focused patches with tests, run the actual test suite wherever possible, record evidence and failures, then publish a draft PR. Grok's stateful trading runtime and Vercel's stateless preview are distinct. Vercel can display read-only diagnostics but is not evidence of continuous worker operation.

## Shipping report
State exactly: files changed, test outcome, build outcome, exchange/demo checked or not, model calibration state, connector/feed health, preview URL, live switch status, remaining blockers. Never state a completed integration from imports or hard-coded status lights.
