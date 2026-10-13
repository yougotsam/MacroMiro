# Strategy registry
| ID | Venue | Version | Inputs | State | Latest evidence |
|---|---|---|---|---|---|
| KALSHI_15M_BINARY | Kalshi 15m YES/NO (BTC/ETH/SOL/XRP/GOLD) | settlement model + paper configs A–E (paper/candidates.ts) | index prints, Kalshi book, Coinbase 15m/1h | PAPER, live locked | Oct 11: all configs negative after fees (A −$26.73 / 142 trades; C −$61.23 / 76; realistic portfolio −$16 to −$26). 80 independent windows (< 200). |
| PERPS_SCALPER | Kalshi perps (BTC, ETH, GOLD first; SOL, XRP, others by registry) | perps-candidate/v1 + aggressive-experimental/v1 sizing | venue WS books/trades/ticker (collector), 1m/1h candles, funding history, fee tiers | PAPER (2B causal replay); orders LOCKED | 21-day causal replay (Sep 21–Oct 12, $500 start): strict 9/13 gate fired **0** times; relaxed ≥7 gate lost on every market and both entry types (best: GOLD maker −$23, maxDD 14%; worst: ETH taker −$204). Maker beat taker everywhere. No config shows evidence of edge. |
| PERPS_SCALPER+INTEL | same | official-calendar macroClear (no look-ahead) | macro-calendar.json | PAPER | adds 7–14 trades per market. GOLD maker −$14 vs −$23 without it, BTC worse (−$100 vs −$90). Not significant. |
| KALSHI_PAIR_UNDER_1 | Kalshi 15m | `src/lib/desk/pair-scan.ts`, `scripts/kalshi-pair-scan.ts` | YES ask + NO ask + taker fees < $1 | BUILT, read-only | Oct 13 scan: all 5 series cost $1.024–$1.06 (no arb). On one binary book the pair is < $1 only if the book is crossed, so this can't fire on single markets by construction. |
| COINBASE_SPOT_SCALP | Coinbase spot | none | candles/trades | REJECTED for now | Intro fees 0.50%/0.90%: round trip ≥ 1.0% vs 15m ATR 0.12–0.24% |
| COINBASE_CFM_FUTURES | Coinbase US dated futures | none | product list | FUTURE (needs futures approval) | listed, e.g. BIT-30OCT26 0.01 BTC, ~10% intraday margin |

Promotion rule (all strategies): purged/embargoed walk-forward, deflated Sharpe, Brier per setup, positive after-cost expectancy at executable prices, owner mandate, safety checklist PASS.
