# MacroMiro

Kalshi perpetuals. One pile, $100 to $200. This is not a promise of profit. Sending is off.

## Scan

Bitcoin, Ether, Solana, XRP, gold, silver, the S&P 500. The data on each is the bid, the ask, the funding rate, and the last swing. Spark, Alexandria, and Firecrawl can sit a trade out when a scheduled number is about to print. They do not choose the side.

## In

A long: price sweeps a prior low, closes back above it, leaves a gap up, and the funding rate is not charging longs. A short is the mirror. Outside that, no trade. The order rests. It does not cross.

## Out

The stop sits past the sweep. If it is hit, the loss is 15% of the pile. Half the position comes off at 1 times that distance. The rest comes off at 2.5 times. After the half, the stop moves to the entry and then trails. Kalshi calls these a stop and a take-profit on the position. They are not a liquidation. A fast market can gap through the stop.

## When it stops

Three losing trades in a row end the day. One or two do not. Down 25% from the pile and the account stops until you reset it. There is no separate 4% day cap.

## Not this

Fifteen-minute contracts stay paper. A published fee test on those windows lost money. Meme coins stay out. A clean scan is not a safe coin.

The code is `src/lib/perps/flip-plan.ts`, `src/lib/perps/manage.ts`, and `src/lib/desk/guard.ts`. None of it has a measured win rate on this account.
