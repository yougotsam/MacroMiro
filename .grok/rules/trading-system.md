# Trading system

`README.md` is the rule. Every 15-minute order goes: pre-trade checklist (`src/lib/signal/checklist.ts`) → evaluator → `guard.ts` → OMS release gate (`CALIBRATED_MODEL_APPROVED`, false until Sameer says the Kalshi keys are on the computer) → `risk.ts` check at the submit choke point.

The side and the chance come from the measured model (`data/signal/model.json`), fit walk-forward on 15-minute bars and kept only when it clears the #124 protocol after fees (200+ trades, CI above zero, most weeks positive). A chance it prints is an Experimental estimate until real fills confirm it. A headline alone is not an entry. MiroFish is null when it is down; never invent a number for it.

Kalshi settles the crypto series on last_60s_windowed_average_15min of the CF RTI. The model's label is the next 15-minute close, which agrees with Kalshi's result about 92% of the time for crypto and 82% for gold.

One trade uses at most 8% of the pile (`TRADE_FRAC`). The day stops at a 25% drawdown (`KILL_FRAC`) or three losses in a row. Two losses in a row halve the size. A correlated group (BTC+ETH+SOL same side) shares one budget. Unknown cash is no trade. No Kelly sizing.

Sameer's own numbers (deposit, split, max loss per trade, day stop) live blank in `src/lib/signal/config.ts` `OWNER_BLANKS`. Do not fill them. Do not invent a probability, a Sharpe, or a fill.
