# AURIX-X / MACROMIRO — CANONICAL TRADING RULEBOOK v1.1
Date: 2026-10-09 | Scope: Kalshi 15m BTC/ETH/SOL/XRP/gold outcomes, separate perps
STATUS: RESEARCH / SHADOW. **CALIBRATED_MODEL_APPROVED=false** blocks all live orders.
Code truth: `src/lib/desk/engine.ts` (research decision engine), `gate.ts` (quote evaluation),
`oms.ts` (sole signed order writer), `risk.ts` (mandatory permission), `config.ts`.
The prior handoff references `src/lib/scan/edge.ts`, a file that does not exist in this ZIP; this retired reference must NOT guide execution.
The original handoff/main-branch and $15 loss rules are retired; see docs/archive.

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
Live is disabled until human approval and unit/integration/shadow tests. Research cap for the previously cited ~$36 account: $3/order, $9 aggregate planned worst loss, -$5 daily new-risk latch; these are changeable only in a reviewed config release. Split same-underlying opportunities into ONE aggregate risk budget.
Optional high-risk promotion is a separate reviewed release and must be justified by demonstrated net edge and real fills, not a 13/13 score. Avoid grid, martingale, uncapped leverage. Pending unknown orders keep maximum-loss reserves until reconciled.
STOP persists across restarts. An override file must not be allowed to silently rebase losses. Perps require an independent margin/liquidation/stop policy.

## PROOF BEFORE PROMOTION
- Source and exact settlement rule for each series verified.
- Settlement reconstruction benchmark against authoritative venue outcomes, including boundary ticks, missing seconds and near-strike cases.
- 3,579 scans grouped by 328 reported distinct contracts; prove unique count independently.
- Training/testing split by expiry event/date; purge overlapping labels.
- Compare price-only settlement model and market quote vs full-feature stack; reject added features without incremental net EV.
- Full order-book bid/ask, tick-grid, fee rounding, exchange shard, timeout replay and WebSocket reconnect tests.
- 200 simulated ambiguous/timeout sends, zero duplicate positions; unknowns remain reserved.
- No live orders until calibrated probabilities, complete data, independent OMS risk checks, and profitable shadow/executable pricing metrics exist.
- After every deployment: actual fills, Brier/log loss, EV after fees, slippage, risk, drawdown, maker selection, and model drift by instrument/expiry bucket.

## OWNERSHIP / STATUS
Desk: market structure / regime / feature definitions. Quillgate: code and tests. Rail: requirement→file→test map. Spark2: live news events. Alexandria: historical calibration evidence. Risk Sentinel: independent approval. OMS: only permitted execution path, audited. The LLM narrates; deterministic code trades.

## IMPLEMENTATION STATUS AS OF 2026-10-09
- PRESENT in source: settlement-model partial last-minute logic, index feed, maker/taker edge, exchange shard and price grids, three-signal guard, risk/OMS, final-market outcome recorder.
- ADDED: `sniper.ts` parameterized feature/evidence diagnostics, read-only `intelligence.ts` bridge to Spark/MiroFish/Alexandria/Firecrawl-backed artifacts.
- NOT AVAILABLE from the supplied source data: true exchange market order flow, 205 confirmed 1h OHLCV bars, CVD, traded-volume VWAP/POC, calibrated historical event probabilities, full broker-perp margin safety, production keys and live exchange validation.
- Correct behavior while unavailable: NO LIVE TRADE; preserve missing-data reasons and continue data collection.
- `docs/AURIX_RELEASE_REPORT.md` is authoritative for testing/provisional fixes.
