# Macro Miro: Kalshi Predictions + Perpetuals and FOMO reference audit
**Researched:** 2026-11-02. **Status:** repository-static inspection and published docs research, NOT account-connection, deployment, integration-test or profitability certification.
**Starting point:** existing MacroMiro main, not a replacement app. The user's Macro-Miro-review.md dated 2026-11-01 is a source input. Existing canonical product scope: docs/product/PRD.md.

## Decision
Preserve two distinct venue lanes: prediction-market binary contracts, and margined perpetual futures. Combine opportunity ranking, research provenance, decision journaling, attribution and operations UI. Never reuse a binary-settlement probability as a perpetual expected return. Keep FOMO as an inspiration for social discovery and opt-in spot research, not an unauthorized US perps gateway.

## What the referenced X post actually contributes
One post, posted 2026-11-01, linked twice in the request:
https://x.com/savipww/status/2116923821064167731

- **Scanner:** subscribe to newly graduated pump.fun Solana tokens, queue 10-minute observation rather than chasing raw listings, reject absent tradeability.
- **Auditor:** eight ordered red-flag checks for supply concentration, liquidity, mint and freeze authority, developer ownership, bundling, delegation, correlated wallets, and sellability. The post describes an exploit caught by the last check, not a reproducible detection result.
- **Analyst:** ask typed yes/no or bounded-probability questions and record all feature inputs; allow a deterministic fallback. AI judgment is never proof of probability calibration.
- **Executor:** use a concrete size and return a trade action. The author's 8% equity and 2% pool-liquidity caps, and approximately $47.50 FOMO fee-floor ticket, are example choices, NOT Macro Miro defaults. Site- and fee-specific.
- **Risk:** watch open positions, propose exits, account for gaps, never quietly move stop further away.
- **Operations/product:** Telegram pushes, one-tap mobile action, daily morning loss/skip report, manual Buy/Sell confirmation, paper-first checkpoint.
- **Copy-trade track:** compare 7-day and 30-day trading persistence, minimum trade counts and complete wallet history instead of one-day leaderboard P&L. The post explicitly describes using an UNOFFICIAL FOMO browser session token with full account access: do not put that token in Macro Miro, and do not interpret a leaderboard as executable alpha.
- **Limit of extraction:** the captured X page exposes the five 'PART' headings but not the actual full master-prompt parts. The source cannot support line-by-line review of those absent blocks. Its performance numbers are author claims, not audited trading statements.

FOMO website confirms social feed/leaderboard/alerts and Web/mobile, but not an official stable trading API. Its own Terms and June 2026 release notes state perpetuals are unavailable to U.S. Persons. Do not proxy around that rule.
https://fomo.family/
https://fomo.family/release-notes
https://production.fomo.family/terms

## Macro Miro snapshot: code vs readiness

| Component | Present on main | Gap before funding |
|---|---|---|
| Predictions scanner/evaluator | src/lib/desk/, src/lib/signal/ | Labels must match exact contract strike, time-to-settlement and venue resolution, not next-candle direction |
| Prediction probability overlay | MiroFish prior added to final model | Test exact deployed model+overlay hash on separate out-of-sample executable quotes |
| Margin market data | src/lib/perps/kalshi-perps-read.ts, stream.ts | Live host/auth/entitlements, full market list, depth, marks, funding, rates and timestamps need account-level verification |
| Margin sizing | src/lib/perps/mandate.ts | Existing POST /api/live/perp-fire bypassed venue-aware sizePosition in favor of client-provided leverage and clip arithmetic |
| Margin execution | src/lib/perps/oms.ts and live-transport.ts | Release path needs server-owned risk, positions, rest orders, correlations, authorization, verified protective exits |
| Protection state | OMS had logged trigger failure but still returned ACK | This PR introduces PROTECTION_FAILED and blocks additional new entries in same process and journal-backed restarts |
| Runtime live route | src/routes/api/live/perp-fire.ts | This PR hard-disables the previous unauthenticated/client-risk-driven entry route. Restoring live needs a separate release |
| Demo/trace | scripts/perps/ | No reproducible demo round-trip, protective-trigger, reconnect, cancel/flatten and overnight worker proof gathered here |
| News research | Firecrawl / Spark / Alexandria / MiroFish present | Evidence timestamp, lead-lag and measurable incremental predictive contribution required |
| Tracking | logs, paper replay, skills, desk views | Need single immutable candidate->order->fill->exit->fees/funding->realized P&L identifier |

**Specific new finding:** perpsReader().balance() currently calls /margin/balance without compute_available_balance=true. Official API documents available_balance defaults to zero unless this query flag is true. Any capital-availability read must explicitly request the higher-cost computed figure or use another documented authoritative field, not assume the omitted value is real zero.

**Source inconsistency:** source docs/operations/RISK_MANDATES.md describes both a 10–25% experimental perps profile and an 8%-of-equity live click path. The current click route was not calling sizePosition. Use exactly one resolved live mandate per venue, versioned and displayed.

**Execution note:** the 2026-10-12 venue matrix recorded margin enabled=true with $0.00 at that time. This is NOT a current authenticated balance check. We did not access keys, accounts, session files, credentials, deposit or place an order.

## Strategy research queue, ordered by measurable edge and execution feasibility

1. **Strike-aware Kalshi 15-minute mispricing:** compare exact outcome settlement probability, not generic next-candle direction, against executable side price + venue fee + impact + conservative uncertainty. Test contract expiry-specific bins and refresh at venue's actual observation cutoff. Reject price if quote age/sequence unknown.
2. **BTC/ETH/GOLD perps microstructure:** 1m/5m book changes, order-flow imbalance, persistent signed trade-flow, spread regime, imbalance reversion vs continuation, funding/mark deviation, liquidity depth. Trade only when estimated executable R and fill rate exceed actual two-way cost. Distinguish opening vs closing book, not cross-market proxy fills.
3. **Sweep/reclaim with structure invalidation:** observable liquidity sweep, MSS/BOS, location relative to session VWAP, quantified stop distance, synthetic or native bracket verification. 2–3R target is a hypothesis, not measured outcome. Report actual average winner/loser and tail slippage.
4. **Maker/taker router:** maker rebate or lower fee is not sufficient; evaluate queue position, nonfill risk, missed breakout and stale order adverse selection. Track expected value conditional on fill.
5. **Funding/OI crowding:** candidate feature using expected funding payment, historical funding, real OI changes and mark/index basis. Do not make funding direction an unconditional buy/sell rule.
6. **Solana new-token audit research:** separate venue adapter for liquid on-chain tokens; RPC checks, transaction fees, sandwich/MEV, sell-route simulation and liquidity lock, wallet cluster risk. No auto-buy through unofficial FOMO account/session APIs.

Recommended research data for short-horizon price impact: Cont, Kukanov & Stoikov, 'The Price Impact of Order Book Events' (doi:10.1093/jjfinec/nbt003; preprint https://arxiv.org/abs/1011.6402). This supports studying imbalance, not guaranteed portable profitability.

### Objective scoring
For each candidate, preserve decision timestamp, venue, market, strategy version, target, stop/invalidation, expected slippage/fees/funding, fill probability, account margin effect, exact book snapshot and independent price/settlement source. Calculate NET expectancy, risk of liquidation and probability calibration (when claims are probabilistic). Rank on reproducible out-of-sample realized net outcomes, not LLM confidence or Twitter profit screenshots. Use a budgeted challenger tournament and keep loss regimes and rejected opportunities.

### AI responsibilities
Use Research+ Spark/Firecrawl to retrieve timely rules, releases, news and debate evidence; use structured outputs with source URLs and timestamps. Use Alexandria for independently sourced economic releases and revisions. Use MiroFish to challenge narratives; do not let simulation personas set calibrated probabilities without tests. Use deterministic code for market orders, notional, sizing, portfolio exposure, cancellation, kill, reconciliation and exchange-specific settlement math.

## Required release path

**P0** Single production owner auth on every mutation route; server-derived balance/available collateral and worst-case loss from venue records; reconcile existing positions, working orders and pending unknown sends; rate limit + durable idempotency; margin-aware sizing and liquidation checks; stops/triggers confirmed on the exchange and separate UNPROTECTED state; operator kill that cancels all and flattens with verified fills. Until these conditions are implemented, entry route must remain disabled.

**P1** Real market websocket sequence tracking and reconnect resnapshot, fees/funding specs, order book/maker simulation vs filled prices; production and demo separation; actual prediction settlement labels; model hash + split ID + clock provenance; automated test matrix.

**P2** Telegram/mobile decision cards, morning loss report, 7d/30d wallet consistency, mint/delegation/holder audits and on-chain token adapter. FOMO has no validated official stable trading API in this review; no session-token trading integration.

**Release evidence**: unit+integration tests, authenticated demo order/create/cancel/trigger/partial fill/unknown network reply, stop reject, disconnection, market halt, cross-account segregation, out-of-sample replay matched to settlement and fee schedules; one independent watchdog process on persistent hosting; signed operator promotion from paper to limited live. Testing and live operator authorization were NOT completed in this review. No profits inferred.

## Kalshi official document inventory
**The complete current API inventory is Kalshi's maintained llms.txt, not this fixed list:** https://docs.kalshi.com/llms.txt . Use that index to discover all new or renamed endpoints and update generated clients. The below is an ordered integration reading list as of 2026-11-02.

### Authentication, account and environments
- https://docs.kalshi.com/getting_started/api_environments
- https://docs.kalshi.com/getting_started/quick_start_authenticated_requests
- https://docs.kalshi.com/getting_started/api_keys
- https://docs.kalshi.com/getting_started/demo_env
- https://docs.kalshi.com/getting_started/rate_limits
- https://docs.kalshi.com/sdks/overview

### Perpetuals overview, books, orders, risk and position management
- https://docs.kalshi.com/margin
- https://docs.kalshi.com/margin/price-banding
- https://docs.kalshi.com/margin-rest/orders/create-order
- https://docs.kalshi.com/margin-rest/orders/get-orders
- https://docs.kalshi.com/margin-rest/orders/get-order
- https://docs.kalshi.com/margin-rest/orders/cancel-order
- https://docs.kalshi.com/margin-rest/orders/cancel-all-orders
- https://docs.kalshi.com/margin-rest/portfolio/get-balance
- https://docs.kalshi.com/margin-rest/portfolio/get-positions
- https://docs.kalshi.com/margin-rest/portfolio/get-fills
- https://docs.kalshi.com/margin-rest/risk/get-risk
- https://docs.kalshi.com/margin-rest/risk/get-risk-parameters
- https://docs.kalshi.com/margin-rest/fees/get-fee-tier-rates
- https://docs.kalshi.com/margin-rest/fees/get-fee-tiers
- https://docs.kalshi.com/margin-rest/exit-triggers/set-cross-exit-trigger
- https://docs.kalshi.com/margin-rest/exit-triggers/get-cross-exit-triggers
- https://docs.kalshi.com/margin-rest/exit-triggers/cancel-cross-exit-triggers
- https://docs.kalshi.com/margin-ws/websockets/orderbook-updates
- https://docs.kalshi.com/margin-ws/websockets/user-orders
- https://docs.kalshi.com/margin-ws/websockets/user-fills
- https://docs.kalshi.com/margin-ws/websockets/market-ticker

### Prediction events, market data, execution, audit trails
- https://docs.kalshi.com/getting_started/orderbook_responses
- https://docs.kalshi.com/api-reference/market/get-markets
- https://docs.kalshi.com/api-reference/market/get-market-orderbook
- https://docs.kalshi.com/api-reference/market/get-market-candlesticks
- https://docs.kalshi.com/api-reference/market/get-trades
- https://docs.kalshi.com/api-reference/events/get-events
- https://docs.kalshi.com/api-reference/orders/create-order-v2
- https://docs.kalshi.com/api-reference/orders/get-orders
- https://docs.kalshi.com/api-reference/orders/cancel-order-v2
- https://docs.kalshi.com/api-reference/portfolio/get-balance
- https://docs.kalshi.com/api-reference/portfolio/get-positions
- https://docs.kalshi.com/api-reference/portfolio/get-fills
- https://docs.kalshi.com/api-reference/portfolio/get-settlements
- https://docs.kalshi.com/api-reference/historical/get-historical-cutoff-timestamps
- https://docs.kalshi.com/api-reference/historical/get-historical-trades
- https://docs.kalshi.com/websockets/orderbook-updates
- https://docs.kalshi.com/websockets/user-fills
- https://docs.kalshi.com/websockets/user-orders
- https://docs.kalshi.com/websockets/cfbenchmarks-value

### Kalshi margin account eligibility, funding and liquidation
- https://help.kalshi.com/en/articles/15357656-applying-for-perpetuals-access
- https://help.kalshi.com/en/articles/15357664-depositing-transferring-withdrawing
- https://help.kalshi.com/en/articles/15357608-your-perpetuals-margin-account
- https://help.kalshi.com/en/articles/15357613-how-funding-works
- https://help.kalshi.com/en/articles/15357594-how-margin-works

## Funding checkpoint
Margin trading requires separate approval, education and separate funding. A 2026-10-12 read-only snapshot isn't an account-verification result today. This review neither moved funds nor verified a current authenticated venue response. Fund only after the account owner confirms entitlement and independently reviews a completed paper/demo and recovery test dossier.

## Change log for this draft PR
- Scope is constrained to a reviewable unmerged branch.
- Live perps POST now returns 403 without a configured verified account operator and 503 even for an operator, until the server-owned trade risk check is implemented. It cannot place a new live order.
- OMS adds PROTECTION_FAILED when post-entry native protective trigger fails and records an alarm in the journal; subsequent new entries are blocked on this process and a journal-backed restart. This is **detection**, not guaranteed emergency liquidation.
- Unit test simulates a venue trigger rejection and checks no false successful order-acknowledgement.

**Do not merge and deploy without running repository tests, deployment compatibility checks, and a complete replacement release path for properly authorized limited live trading.**
