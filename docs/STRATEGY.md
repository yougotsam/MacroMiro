# AURIX-X / MACROMIRO — 15-minute rulebook v1.1
Date: 2026-10-09 | Scope: Kalshi 15m BTC/ETH/SOL/XRP/gold outcomes, separate perps
SUPERSEDED as the product spec by `docs/product/PRD.md` (2026-10-14). This file stays as the 15-minute rulebook only. If it disagrees with the PRD, the system map, the strategy registry, the venue matrix, or the risk mandate, those win.

## DECISION 21 OCT 2026
The log-odds steps are on the order path.

- Base chance stays the settlement distance: spot versus strike, volatility, and seconds left.
- A sniper score of at least 11, or a feature score of at least 0.75, adds a logit of +0.80 in the direction of that score. A score of at least 8, or a feature score of at least 0.45, adds +0.45. This step is not cut at 4 points.
- Spark moves the same chance by 0.25 when the brief is fresh and names the asset. Alexandria moves it when the file is under 7 days old and carries a probability. A Firecrawl seed under 24 hours scales that news step by 1.25. A missing file adds nothing.
- Half-Kelly is `0.5 × (b·p − (1−p)) / b`, then at most 15% of equity, then at most $3.
- The buy range is 36¢–95¢. Under 36¢ is refused. Over 95¢ is refused. The order still needs the chance to beat the price and the fee. The dollar cap stays $3 until money is added. The 36¢ floor comes from the settled journal through 2026-10-22: 26 buys under 36¢, 3 wins, about −$29.50, and both time halves lost. That sample is under 30. It cuts a measured loss. It does not prove the band above 36¢.
- Three settled losses in a row pause 20 minutes. One loss does not. One live order per contract. A second series in the same 15 minutes is allowed. Spark, Alexandria, and Firecrawl stay on and run when a ticket clears the gate.
- Meme coins and perps do not send from this file.

STATUS: LIVE 15-minute tickets only when the three switches are on. **CALIBRATED_MODEL_APPROVED=true** in `src/lib/desk/config.ts`. Perpetual orders stay off.
Code truth: `src/lib/desk/engine.ts` (research decision engine), `gate.ts` (quote evaluation),
`oms.ts` (sole signed order writer), `risk.ts` (mandatory permission), `config.ts`.
The prior handoff references `src/lib/scan/edge.ts`, a file that does not exist in this ZIP; this retired reference must NOT guide execution.
The original handoff/main-branch notes are archived in docs/archive. Current loss limits (including the approved −$15 Kalshi daily stop) live in docs/operations/RISK_MANDATES.md. Canonical product spec: docs/product/PRD.md.

## ONE STRATEGY, TWO PRODUCT ENGINES
AURIX-X trades only when: valid setup AND independent evidence AND calibrated outcome model AND executable after-cost positive edge AND final risk approval.
The prediction engine models Kalshi's exact market outcome. The perp engine models a specified target-before-stop policy, fees, funding, liquidation and market impact. Their labels, position sizes and APIs are independent. A confluence score is NOT a win probability.

## PIPELINE (MANDATORY ORDER)
0. STOP/auth/credential integrity and unknown-order reconciliation.
1. Exchange shard and market-status verification; market ticker, resolution rules and price ranges.
2. Source validity: reference index, timestamps, exchange spot trades, order-book bids, news, funding/OI where applicable.
3. Regime: TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION, SHOCK, UNKNOWN.
4. Map confirmed 15m/1h market structure, liquidity references, and session-specific ranges.
5. Generate candidates from approved strategy modules; no setup => NO_TRADE.
6. Assess independent confluence groups; check conflicting signals.
7. Estimate exact contract settlement probability using an OUT-OF-SAMPLE CALIBRATED model.
8. Compute executable YES and NO net expectancy separately; include fee rounding, queue/fill uncertainty and adverse selection.
9. Allocate total risk across correlated contracts, already-held inventory, pending and open orders.
10. OMS performs final independent check, submits one uniquely identified order, reconciles fills and cancels.
11. Record features, reasons, quote, fills, fee, risk, result. Calibrate only on leakage-free historical periods.

## REGIME FILTERS (UNVALIDATED RESEARCH DEFAULTS)
- ADX14(15m) <18 => range candidate; >25 => trend candidate.
- EMA50(1h) 5-closed-bar slope + confirmed BOS/MSS => directional context.
- Bollinger 20,2 width <20th percentile => compression; >80th => expansion.
- ATR14 ratio versus rolling median and exceptional spread => shock veto.
- Use completed bars for structure. Intracontract reference-value prints can update settlement model.
- No universal FX kill-zone requirement for 24/7 crypto; study hour-of-week and actual liquidity.

## CONFIRMATION STACK, 13 POINTS TOTAL
1. Confirmed BOS/MSS + higher-timeframe structural bias: 0–2.
2. Sweep/rejection and location at real prior highs/lows, FVG, OB, fib: 0–3.
3. Genuine traded volume/flow (RVOL, CVD, book) where available: 0–2.
4. Trend/momentum group: EMA7/14/50/200, RSI14, Stoch RSI 14/14/3/3, MACD12/26/9: 0–2.
5. Regime, timing, and volatility fitness (ATR14, BB20/2, opening range): 0–2.
6. Fundamental/funding/OI/major event compatibility: 0–1.
7. Confirmed entry candle, price space, validity of trigger: 0–1.
Starting ranking: <8 reject; 8 watch; 9–10 research-qualified; 11–13 high-confluence.
At least 4 independent groups must contribute. Scores NEVER become percentages and never override pricing or risk veto. Thresholds must be walk-forward tested.

## QUANTIFIED SNIPER MODULES
A. GHOST_SWEEP REVERSAL: Confirmed session/swing extreme; price crosses by >=0.10 ATR15; closes back inside on current/next 15m bar; rejection close upper/lower 35% appropriate to side; confirm 1m/5m MSS or flow. Enter only retest/confirmed trigger.
B. VELOCITY_RELOAD CONTINUATION: 1h trend + 15m BOS, retrace into VWAP/EMA20/FVG/OB or 61.8–65% golden pocket, pullback volume decays, 1m/5m resume trigger.
C. ORB_PREDATOR: Instrument-specific opening range, break >=0.15 ATR15, RVOL >=1.5 versus matched time baseline, retest/acceptance; reject nearby opposing liquidity.
D. MAGNET_SCALPER: Only in RANGE; price touches tested range edge / value area, rejection plus exhaustion; target VWAP/midrange; never fade a genuine expansion.
E. LEVERAGE_TRAP (perps only): Funding >95th or <5th percentile, OI regime shift, liquidation events, and CONFIRMED price reversal or continuation; funding alone is never a trade.
F. EXPIRY_EDGE (Kalshi outcome): Contract-specific index, precise strike, quarter-hour settlement arithmetic, observed final-window index ticks, time-to-expiry, volatility and quote-dependent expected value. Scalp repricing or hold-to-settlement policy must be validated separately.
G. MAKER_HUNTER (Kalshi): Post only at permitted market tick grid when conservative EV and estimated after-fill adverse selection remain positive; otherwise don't post.

## REQUIRED FEATURE DATA AND HONEST LIMITATIONS
Kalshi CF index 1-second series are suitable for settlement probability and index price bars. THEY DO NOT CONTAIN EXCHANGE-TRADED VOLUME, AGGRESSOR SIDE, VWAP, CVD OR VOLUME PROFILE.
Separate exchange spot/futures trade, volume and order-book feeds are required. Keep feed/source tags; never represent a proxy as consolidated volume.
15m and 1h EMA200 need sufficiently long HISTORY: a one-hour buffer of one-second prints cannot produce them. A new candles/feature-registry service must produce trustworthy multi-timeframe features. No retrospective pivot use until confirmation.

## MARKET LOCATION / SWING RULES
- 15m and 1h swing pivot: 3 preceding and 3 following completed candles; becomes valid at confirmation, not formation time.
- Equal high/low tolerance max(2 venue ticks, 0.10 ATR15).
- BOS: confirmed close beyond pivot by 0.15 ATR15 plus candle-body displacement >1.2 × median past 20 bodies.
- Bullish three-candle FVG A,B,C: high(A)<low(C); size >=0.12 ATR15, invalidate after confirmed opposing structure; reverse for bear.
- Order block candidate: last opposite candle preceding structural displacement; NO assumption of institutional execution.
- Fib range position=(spot-swingLow)/(swingHigh-swingLow). For bullish retracement to 61.8% from HIGH, normalized position is 0.382. Test fib zone incremental predictive value.

## PRICE / PROBABILITY / ECONOMICS
Binary YES payout $1 success/$0 failure. pYES and pNO=1-pYES for the true binary settlement.
BUY YES conservative EV/share = pYES_lower - executableYESask - all expected fees and costs.
BUY NO conservative EV/share = pNO_lower - executableNOask - all expected fees and costs.
For a MAKER order, use fill probability, likelihood of adverse selection, queue priority, and expected fee; do not treat a resting bid as guaranteed execution.
Candidate research thresholds: conservative YES/NO maker >1c, taker >4c. NOT validated; select by training, then hold out test. Never insert a ±4 percentage point price-action adjustment without calibration.
Limit orders can cross inadvertently if the book moves; server post_only or IOC conditions must be verified.
Classify NO_TRADE explicitly: market paused, unknown settlement, index stale, missing historical tick, missing fee, no volume source, no qualified setup, uncalibrated, negative edge, too thin book, risk, unknown order.

## NEWS / FUNDAMENTAL STACK
Spark2 parses sourced events (time, consensus, actual, surprise, direction candidates, uncertainty). Alexandria stores observed event-to-asset and regime response, leakage-free train/validation/test splits, and calibrated probabilities. Neither LLM may directly authorize trading.
Default major scheduled macro veto: new trades 30m before and until at least 15m after release, subject to spread/vol normalizing. Crypto exchange outages and oracle/source anomalies hard veto. News model relevance is asset- and horizon-specific.

## RISK / ALLOCATION
The live dollar caps are in `src/lib/desk/config.ts` and enforced again in `risk.ts` before any POST. Day stop −$15. Open worst-case $9. One order $3. One ticker $3. Same-direction crypto $4. The −$5 latch is not in force. `ENABLE_RISK_OVERRIDES` is false, so a file on disk cannot rebase the day's loss. Three settled losses pause new orders for 20 minutes. One loss does not. Pending unknown orders keep their worst-case reserve until reconciled. Avoid grid, martingale, and uncapped leverage. Perps are a separate route (`PERPS_ORDERS_LOCKED` is false; the 15-minute engine does not call it).

## PROOF BEFORE PROMOTION
- Source and exact settlement rule for each series verified.
- Settlement reconstruction benchmark against authoritative venue outcomes, including boundary ticks, missing seconds and near-strike cases.
- 3,579 scans grouped by 328 reported distinct contracts; prove unique count independently.
- Training/testing split by expiry event/date; purge overlapping labels.
- Compare price-only settlement model and market quote vs full-feature stack; reject added features without incremental net EV.
- Full order-book bid/ask, tick-grid, fee rounding, exchange shard, timeout replay and WebSocket reconnect tests.
- 200 simulated ambiguous/timeout sends, zero duplicate positions; unknowns remain reserved.
- The three switches can send. That is not a profitability claim. Through 2026-10-22 the journal had 49 settled fills, 14 wins, about −$28. The buys under 36¢ were 26 of those. The floor is there because both halves of that cell lost. Buys at or above 36¢ were 23 fills and about +$1, and the newer half of that cell lost. Do not describe that as an edge.
- After every deployment: actual fills, Brier/log loss, EV after fees, slippage, risk, drawdown, maker selection, and model drift by instrument/expiry bucket.

## OWNERSHIP / STATUS
Desk: market structure / regime / feature definitions. Quillgate: code and tests. Rail: requirement→file→test map. Spark2: live news events. Alexandria: historical calibration evidence. Risk Sentinel: independent approval. OMS: only permitted execution path, audited. The LLM narrates; deterministic code trades.

## IMPLEMENTATION STATUS AS OF 2026-10-21
- The 15-minute path can send when the three switch files are on, the −$15 day is not latched, and `gate.ts` plus `risk.ts` both pass. `CALIBRATED_MODEL_APPROVED` is true. `APPROVAL_POLICY_ENFORCED` is false.
- Settlement chance, maker/taker edge, the 36¢–95¢ band, the three-loss pause, and the logit steps are in `config.ts`, `gate.ts`, `features.ts`, and `risk.ts`.
- A chart that names the other side sits the ticket. A chart that names nothing does not. The last closed 1-minute price must be on the same side of the 200 EMA as the order. Above it, only yes. Below it, only no. Fewer than 200 closed minutes sits. Fib 38.2–61.8 and the 20/50 pullback can agree with a priced side. They do not set the chance.
- A fresh disagreeing Spark, Alexandria, or MiroFish read sits the ticket (`intel-gate.ts`). A stale or missing Spark card also sits the ticket.
- Not in the settlement math: exchange-traded volume, CVD, and a calibrated event model. Missing tape does not invent a side. It does not, by itself, turn the three switches off.
- `docs/archive/` is history. A sentence there that says the day stop is −$5 is not the rule.
