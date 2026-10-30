# MacroMiro

Kalshi perpetuals. One pile, $100 to $200. This is not a promise of profit.

## How a trade works

You press long or short. That press is the side. The markets are Bitcoin, Ether, Solana, XRP, gold, silver, and the S&P. The stop can lose 8% of the pile. Three full stops are 24%. The account stops at 25%.

Half comes off one risk-unit from the entry. That used to be the midpoint of the target, which paid you less than one times the risk. The rest comes off at the target on the slider. It starts at 2.5. After the half, the stop moves to the entry and then trails.

One loss does nothing. Two do nothing. The third ends the day. Do not raise the clip after a win. The screen does not scale the clip up.

## Why 8%, not 15%

A 15% stop makes the third loss impossible. Two stops are already 30%, past the 25% account stop. The three-loss rule only means something if each stop fits under that hole.

## Fifteen-minute contracts (BTC, ETH, SOL, XRP, gold)

Every 15 minutes the pre-trade checklist (`src/lib/signal/checklist.ts`) runs: fresh data, structure (BOS / ChoCH), liquidity sweep, gaps and order blocks, premium / discount, EMA stack and 13/50/200/800 tunnel, RSI and divergence, ADR used, VWAP side, killzone, release clock, news (Spark, rates, MiroFish — null when it is down), then the measured chance and the edge after fees at our own bid.

The weights come from data, not opinion: `bun scripts/signal-fetch-bars.ts 180 && bun scripts/signal-train.ts` refits them walk-forward and writes `data/signal/report.md`. A product trades only when its verdict is KEPT under the #124 protocol (200+ trades, positive after fees with 95% confidence, most weeks positive). Today: 15-minute contracts KEPT (+2.5¢ a contract at a 51¢ maker fill), perps not kept.

Two losses in a row halve the size; three end the day. No Kelly sizing. Your own numbers (deposit, split, max loss per trade, day stop) are blank in `src/lib/signal/config.ts` until you fill them.

Reports: `bun scripts/desk-reports.ts bias|scan|review|weekly` writes to `data/reports/`. Research jobs run outside the price loop: `bun scripts/intel-worker.ts --loop 30`.

## Going live

Orders stay off until `CALIBRATED_MODEL_APPROVED` in `src/lib/desk/config.ts` is set to true after the Kalshi keys are on the computer. That is the only switch left; the three desk switches still have to be on as well.

## Not this

Meme coins stay out. No Hyperliquid. A headline alone does not pick the side.

The code is `src/lib/signal/`, `src/lib/desk/evaluator.ts`, `src/lib/perps/flip-plan.ts`, `src/lib/perps/manage.ts`, and `src/lib/desk/guard.ts`.
