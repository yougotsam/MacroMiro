# Strategy registry
| ID | Venue | Version | Inputs | State | Latest evidence |
|---|---|---|---|---|---|
| KALSHI_15M_BINARY | Kalshi 15m YES/NO (BTC/ETH/SOL/XRP/GOLD) | settlement model + paper configs A–E (paper/candidates.ts) | index prints, Kalshi book, Coinbase 15m/1h | LIVE PATH when the three switches are on. A quiet chart sits. Paper replay is not that path | Oct 11 paper replay: configs were negative after fees. That replay is not a live score. |
| PERPS_SCALPER | Kalshi perps | perp-desk lean + `POST /api/live/perp-fire` | venue book, funding, the contract's own leverage | LIVE PATH. Needs the three switches, a stop, and leverage from the contract. Candle replay is still not a fill | 2026-10-20 candle replay is not a fill and is not a live score. |
| PERPS_SCALPER+INTEL | same | official-calendar macroClear (no look-ahead) | macro-calendar.json | PAPER | 2026-10-20 replay: calendar used only after fetchedAt 2026-10-17. Trade list matched aggr7. Not a fill. Not significant. |
| KALSHI_PAIR_UNDER_1 | Kalshi 15m | `src/lib/desk/pair-scan.ts`, `scripts/kalshi-pair-scan.ts` | YES ask + NO ask + taker fees < $1 | BUILT, read-only | Oct 13 scan: all 5 series cost $1.024–$1.06 (no arb). On one binary book the pair is < $1 only if the book is crossed, so this can't fire on single markets by construction. |
| COINBASE_SPOT_SCALP | Coinbase spot | none | candles/trades | REJECTED for now | Intro fees 0.50%/0.90%: round trip ≥ 1.0% vs 15m ATR 0.12–0.24% |
| COINBASE_CFM_FUTURES | Coinbase US dated futures | none | product list | FUTURE (needs futures approval) | listed, e.g. BIT-30OCT26 0.01 BTC, ~10% intraday margin |
| RESOLUTION_RIDER | Kalshi 15m, last 90 seconds | `src/lib/deskc/rider.ts` | favorite inside the existing price band, closed 1m momentum, spread ≤ 2 ticks, order flow or a 2-sigma stand-in | RESEARCH. The live sender does not import it. Eligible only after the scorecard promotion rule. | Not scored yet. No live orders. |

Promotion rule (all strategies): purged/embargoed walk-forward, deflated Sharpe, Brier per setup, positive after-cost expectancy at executable prices, owner mandate, safety checklist PASS.
