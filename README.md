# MacroMiro

File 1. This page is the rule. Where the code disagrees, the code gets changed next. Nothing else is edited in this pass.

## One deposit

You fund Kalshi once. That deposit is the bankroll.

Kalshi then holds it in two balances. The help page updated this week says the prediction balance and the perpetuals margin account do not share funds, and a perpetual liquidation cannot touch the prediction balance. A perpetual order cannot spend prediction cash by itself. You move money between the two in the Portfolio tab. You can move it back.

The bot trades both products from that one deposit. It does not ask for a second deposit. It also does not pretend the two balances are already one pile. Spending prediction cash on a perpetual, before the move, is an order Kalshi rejects.

## The two products

A 15-minute contract is a ticket. It expires at the end of the window. It has no leverage.

A perpetual stays open until it is closed, stopped, or liquidated. Leverage is the number printed on that contract. Gold can be higher than Bitcoin because the contract says so. The cash posted is the contract price divided by that leverage. The limit on that cash is a slice of the money sitting in the margin balance, not a fixed $3.

## How a 15-minute contract settles

You are not betting the last price on the screen.

Crypto, such as Bitcoin, settles YES when the average of 60 one-second CF Benchmarks prints in the final minute is at or above the same kind of average from the start of the window. One late print does not settle it. The index is not Coinbase's last trade.

Gold, silver, oil, natural gas, copper, and the currency contracts settle on a Pyth price. They do not use the Bitcoin average.

## How a perpetual is allowed to open

The book is readable. Funding is known and is not charging that side. The order carries a stop. The cash it posts is inside the slice of the margin balance. Cancel, positions, and fills are read from the margin account. An empty list means Kalshi returned none.

## What the code still does wrong

The code still refuses a 15-minute order over $3 and a perpetual whose posted margin is over $3. It also still uses a −$15 day stop and a $9 open cap from the old files. Those numbers are not this page. The next file is `src/lib/desk/config.ts`. No other file moves until that one is next.

A quiet chart sits. An old news card sits. Those two stay until their own files.

## Code

`main` is the only line. Node 22. After a change: `bun test`, `npm run typecheck`, `npm run lint`. Do not commit secrets or anything under `data/`.
