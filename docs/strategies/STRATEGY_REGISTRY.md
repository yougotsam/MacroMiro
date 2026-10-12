# Strategy registry
| ID | Venue | Version | Inputs | State | Latest evidence |
|---|---|---|---|---|---|
| KALSHI_15M_BINARY | Kalshi 15m YES/NO (BTC/ETH/SOL/XRP/GOLD) | settlement model + paper configs A–E (paper/candidates.ts) | index prints, Kalshi book, Coinbase 15m/1h | PAPER, live locked | Oct 11: all configs negative after fees (A −$26.73 / 142 trades; C −$61.23 / 76; realistic portfolio −$16 to −$26). 80 independent windows (< 200). |
| PERPS_SCALPER | Kalshi perps (BTC, ETH, GOLD first; SILVER, SOL, XRP, DOGE, SHIB, US500) | perps-candidate/v1 | venue 1m/1h candles, book, funding, fee tiers | RESEARCH (2A), orders locked | Oct 12 trace: BTC short TREND_PULLBACK 5/13 → NO_TRADE (confluence < 9). Break-even win rate 45%. |
| KALSHI_PAIR_UNDER_1 | Kalshi 15m | not built | YES ask + NO ask + fees < $1 | PLANNED (2B, read-only) | none |
| COINBASE_SPOT_SCALP | Coinbase spot | none | candles/trades | REJECTED for now | Intro fees 0.50%/0.90%: round trip ≥ 1.0% vs 15m ATR 0.12–0.24% |
| COINBASE_CFM_FUTURES | Coinbase US dated futures | none | product list | FUTURE (needs futures approval) | listed, e.g. BIT-30OCT26 0.01 BTC, ~10% intraday margin |

Promotion rule (all strategies): purged/embargoed walk-forward, deflated Sharpe, Brier per setup, positive after-cost expectancy at executable prices, owner mandate, safety checklist PASS.
