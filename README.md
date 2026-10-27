# MacroMiro

This is the desk. The prompt that asked for 100 to 300 stock strategies, a US equity tick feed, and a live flip tonight does not survive contact with this account. What follows is the part that does.

## What this account is

One deposit, $100 to $200. Two Kalshi piles: prediction contracts and perpetuals. They do not share cash. This repo does not move money between them.

There is no licensed US equity tape here. Phase 3 of that prompt (Hasbrouck VAR, Lee-Ready, impulse responses) is not built, because inventing those numbers is forbidden. Ask for a data budget before anyone builds it.

## What was wrong in the prompt

- McLean and Pontiff (2016), 97 stock anomalies: returns were about 26% lower out of sample and about 58% lower after publication, versus the original sample. A later international paper quotes that split. Blogs that say "32%" are describing a different cut of the same study. The decay is about published stock anomalies, not a license to skip testing on Kalshi.
- A deflated Sharpe above 0.95 (Bailey and López de Prado, 2014) means "unlikely to be just the best of many tries." It is a test result, not a number this repo has earned. No Sharpe is reported here.
- "Fire only if probability is above 0.80" is rejected. There is no calibrated probability on this account. A threshold with nothing behind it is a costume.
- TradingAgents (Xiao, Sun, Luo, Wang; UCLA / MIT) is a stock-research role play. It is not a Kalshi execution system. The useful piece is the split: a researcher, a bull, a bear, and a risk seat. The risk seat does not place the order.

## The three seats

- Reflex names a side from closed 1-minute prices: 9-period average versus 21, a retest of the 9, and RSI 14 in a band (52–68 up, 32–48 down). That is a hypothesis. It is not a kept strategy.
- Guard is `src/lib/desk/guard.ts`. It does not fire unless a separate review has marked the setup kept and a probability has been measured on settled outcomes. Neither has happened. So the 15-minute path records the setup and sends nothing.
- Brain is this page plus a human. One change at a time. Nothing ships itself live.

## Risk, tighter than the prompt

The prompt's examples were 1% per trade and a 15% kill. Escalation may tighten a limit. It may not loosen one. On this pile:

- One trade may post at most 1% of the cash in the pile it spends.
- The day halts at 4% of that pile.
- The kill switch is 10% of that pile, not 15%.
- Unknown cash is no order.
- No martingale.
- News, Spark, Alexandria, Firecrawl, and MiroFish are data. None of them is allowed to place an order or to talk the guard into firing.

15-minute sending stays off in `src/lib/desk/config.ts` until you say otherwise, in writing, after a review.

## Perpetuals

A buy rests on the bid. A sell rests on the ask. Cash posted is price divided by leverage. Stop and target are the sliders. There is no entry signal, and the button does not yet read the margin pile, so it cannot enforce the 1% rule. Do not click it.

## What can blow this desk up

- Treating the 9/21 retest as a kept edge. It is a public scalping pattern. It has not been scored here.
- Clicking the perpetual button. It is outside the guard.
- Turning the send flag on to "see what happens."
- Filling a missing equity tape, a missing Sharpe, or a missing probability with a guess.
- A 15-minute contract still goes to zero or to one dollar. A 1% post is small. It does not make the contract safe.

## Not done, on purpose

No shortlist of surviving strategies. No liquidity-stress table. No microstructure VAR. No paper-versus-backtest report. Those require data this repo does not have. The next phase starts when you approve a data budget, not before.
