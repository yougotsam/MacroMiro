# Risk mandates (per venue)
## Kalshi 15m YES/NO: APPROVED by owner (enforced in `src/lib/desk/config.ts` + `risk.ts`)
Daily stop −$15 · max open risk $9 · max $3 per order until a deposit changes it · max $3 per ticker · correlated crypto $4 · price band 36¢–95¢ · one order per contract, not per window · three settled losses then 20 minutes off · a logit of 0.80 at a score of 11 · snapshot stale after 20 s · 1 order per tick. The chance still has to beat the price and the fee. The 36¢ floor is the settled-loss cut in `config.ts`. Spark returns a probability. Alexandria’s rate odds apply to gold, silver, and FX. Firecrawl scrapes in enhanced mode.

## Kalshi perps CONSERVATIVE v1 (2026-10-12): REJECTED BY OWNER, SUPERSEDED
Kept only as a record. The $100 equity/notional caps, 3× leverage, $1 per trade, −$5/day, −$15/week, 2 positions,
maker-only entries and news/funding blackouts are **not** in force. Code: `CONSERVATIVE_V1_REJECTED` in `src/lib/perps/mandate.ts`.

## Kalshi perps AGGRESSIVE_EXPERIMENTAL v1: `aggressive-experimental/v1` (PROPOSED; paper/demo only; live needs explicit owner approval)
Code: `src/lib/perps/mandate.ts` (sizing), `margin.ts` (margin/liquidation math), `manage.ts` (exits), `oms.ts` (locked order manager).
| Rule | Value |
|---|---|
| Leverage | dynamic, up to the venue's per-asset max *open* leverage = `leverage_estimates[notional]` ÷ `initial_margin_multiplier` (GOLD ≈ 11.7×, BTC ≈ 4.9×, ETH ≈ 3.8×, SOL/XRP lower) |
| Risk at invalidation | configs 10 / 15 / 20 / 25% of dedicated equity, costs included (fees both legs + slippage + adverse funding) |
| Deployment caps (modelled) | all initial margin ≤ 90% of equity; one market ≤ 75%; one correlation group (crypto majors / metals / index) ≤ 85% |
| Liquidation | stop must sit ≤ 80% of the way to the modelled liquidation price (equity = maintenance × `liquidation_margin_ratio_threshold`). Loss CAN exceed margin on gaps: Kalshi says liquidation "can't guarantee your balance won't go negative" |
| Drawdown | warnings at 20/35/50% from peak. Automatic halt only at an operator-selected limit (`operatorDrawdownLimitPct`; nothing silent) |
| Event trades | allowed if after-cost payoff stays positive |
| Funding | cost/benefit in P&L (venue historical rates) and a crowding feature. Not a blackout |
| Entry type | maker or taker chosen on total execution quality (fees + spread + miss risk) |
| Exits | native bracket (stop_loss_price + take_profit_price), partial bracket at 1R (`count`, `client_trigger_id`), break-even after partial, native trailing (`kind=trailing`, `trail_amount`), thesis-invalidation exit, max hold. Always reduce-only; never reverse |
| Mechanical protections (kept) | authenticated kill = cancel-all + reduce-only IOC flatten; journal-before-send; idempotent `mm-perps-` client IDs; duplicate refusal; reconcile on uncertainty (never resend); unknown-order and unmanaged-position detection block new entries; restart recovery from exchange positions |

### What the numbers look like (real venue specs, 2026-10-13; long at last price; from `scripts/perps/report.ts`)
In practice, for tight scalp stops, the **single-market margin cap binds before the risk %**, so 10% and 25% give the same size. The risk % only binds on wider stops.
| Equity | Market | Stop | Risk cfg | Contracts | Notional | Leverage | Initial margin | $ risk at stop | Liq. distance | Binding |
|---|---|---|---|---|---|---|---|---|---|---|
| $250 | GOLD | 0.21% (median scalp) | any | 524 | $2,199 | 8.8× | $187 | $4.93 (2.0%) | 5.2% | single-market margin |
| $250 | GOLD | 2% (wide) | 15% | 443 | $1,859 | 7.4× | $158 | $37.42 (15.0%) | 7.4% | risk |
| $250 | GOLD | 2% (wide) | 25% | 524 | $2,199 | 8.8× | $187 | $44.26 (17.7%) | 5.2% | single-market margin |
| $250 | BTC | 0.31% | any | 109 | $912 | 3.65× | $186 | $4.08 (1.6%) | 13.9% | single-market margin |
| $250 | BTC | 2% | any | 109 | $912 | 3.65× | $186 | $19.52 (7.8%) | 13.9% | single-market margin |
| $500 | GOLD | 0.21% | any | 1,050 | $4,406 | 8.8× | $375 | $9.77 (2.0%) | 5.1% | single-market margin |
| $500 | GOLD | 2% | 15% | 887 | $3,722 | 7.4× | $317 | $74.92 (15.0%) | 7.4% | risk |
| $500 | BTC | 0.31% | any | 219 | $1,833 | 3.7× | $374 | $8.20 (1.6%) | 13.7% | single-market margin |
| $500 | BTC | 2% | any | 219 | $1,833 | 3.7× | $374 | $39.23 (7.9%) | 13.7% | single-market margin |
| $1,000 | GOLD | 0.21% | any | 2,100 | $8,812 | 8.8× | $750 | $19.54 (2.0%) | 5.1% | single-market margin |
| $1,000 | GOLD | 2% | 15% | 1,775 | $7,448 | 7.4× | $634 | $149.93 (15.0%) | 7.4% | risk |
| $1,000 | BTC | 0.31% | any | 439 | $3,674 | 3.7× | $749 | $16.44 (1.6%) | 13.7% | single-market margin |

## Hard drawdown + watchdog (2026-10-13) — PENDING OWNER DECISION
- A separate risk watchdog process (`scripts/loop/watchdog.ts`) polls every 60 s. Paper only.
- Perps hard drawdown limit: **50% (paper default, = top existing warning). PENDING OWNER DECISION.** On breach: cancel-all + reduce-only flatten via `PerpsOms.killAndFlatten` (paper exchange) and a SEV1 incident.
- Kalshi 15m −$15 day stop now also FLATTENS open paper positions (at our-side bid − 1¢), not just blocks new entries.
- Fail-closed: if the watchdog heartbeat is older than 3 minutes, every engine refuses NEW entries (exits allowed).
- `CALIBRATED_MODEL_APPROVED` is true in `src/lib/desk/config.ts`. The blind-gate checklist (200 out-of-sample trades, mean above 0 after costs, Newey–West t above 2, drawdown at most 50%) is not a runtime lock. `APPROVAL_POLICY_ENFORCED` is false.
