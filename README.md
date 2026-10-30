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

The weights come from data, not opinion: `bun scripts/signal-fetch-bars.ts 180 && bun scripts/signal-train.ts` refits them walk-forward and writes `data/signal/report.md`. A product trades only when its verdict is KEPT under the #124 protocol (200+ trades, positive after fees with 95% confidence, most weeks positive). Today: 15-minute contracts KEPT (+2.3¢ a contract after fees at a 51¢ fill, 3,559 test trades), perps not kept.

Two losses in a row halve the size; three end the day. No Kelly sizing. Your own numbers (deposit, split, max loss per trade, day stop) are blank in `src/lib/signal/config.ts` until you fill them.

Reports: `bun scripts/desk-reports.ts bias|scan|review|weekly` writes to `data/reports/`. Research jobs run outside the price loop: `bun scripts/intel-worker.ts --loop 30`.

## Going live

Orders stay off until `CALIBRATED_MODEL_APPROVED` in `src/lib/desk/config.ts` is set to true after the Kalshi keys are on the computer. That is the only switch left; the three desk switches still have to be on as well.

## Not this

Meme coins stay out. No Hyperliquid. A headline alone does not pick the side.

The code is `src/lib/signal/`, `src/lib/desk/evaluator.ts`, `src/lib/perps/flip-plan.ts`, `src/lib/perps/manage.ts`, and `src/lib/desk/guard.ts`.

## Perps: tested with Sameer's own rules

`bun scripts/signal-perps.ts` replays 180 days of 15-minute bars with the real rules: a bracket entry on the bid, a stop sized so a loss costs 8% of the pile (5× notional cap), half off at 1R, the rest trails to 2.5R, exit on the ask, 3 losses in a row end the day, down 25% stops the series, Kalshi fees and funding (00/08/16 New York) charged. Results are in `data/signal/perps-report.md`. After fees: BTC −26%, ETH −26%, SOL −29%, XRP −28%, gold +1%. None is kept. The button stays manual.

## News and MiroFish

- Official CPI / jobs / PPI / Fed times live in `data/signal/news/calendar.json`. No calendar = no trading.
- Trades are blocked 15 minutes before to 30 minutes after a release (measured: those were the losing minutes).
- The move a release causes counts for the next 4 hours (`release_drift`, the biggest measured weight).
- Headline tone (GDELT) is wired in, but GDELT is rate-limiting this machine, so tone history is empty and its weight is 0 until the refresh fills it.
- MiroFish gives a direction from its scenario text, never a percent; down = nothing. Weight 0.15 is a written-down prior until 30 runs are scored (`bun scripts/mirofish-score.ts`; today 4 of 4 calls right from one CPI run).

## Gold feed, fills, schedule

- Gold = OKX spot-gold perpetual 15-minute bars (public), replacing PAXG.
- `bun scripts/fills-vs-51.ts` compares real fills with the 51¢ assumption (so far: 0 fills of 69 orders).
- `ops/crontab` (New York time): 6 AM bias, 7 AM scan, 4 PM review, Sunday weekly, data refresh, research worker. Install with `crontab ops/crontab`.
