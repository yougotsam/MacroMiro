# MacroMiro

File 1 of the rebuild. This page is the rule. Where the code disagrees, the code is changed on a later file. This pass edits only this page.

## One deposit

You fund Kalshi once. That deposit is the whole bankroll.

Kalshi then keeps two balances. Its help page, updated the week of 24 Oct 2026, says the prediction balance and the perpetuals margin account do not share funds. A liquidation on a perpetual cannot touch the prediction balance. A perpetual order cannot spend prediction cash by itself. You move money between them in the Portfolio tab, and you can move it back.

The bot trades both products from that one deposit. It does not ask for a second deposit. It does not pretend the two balances are already one pile.

## The job

Turn a few hundred dollars over, aggressively, by taking only the trades where the price is worse than the measured chance, and by keeping one loss smaller than the account. A ten-times account is the aim. It is not a promise. A bot that is trending on X is a lead to check, not a rule to paste.

## Product 1. The 15-minute contract

A ticket. It expires. No leverage.

Crypto, such as Bitcoin, settles YES when the average of 60 one-second CF Benchmarks prints in the final minute is at or above the same kind of average from the start of the window. One late print does not settle it. The index is not Coinbase's last trade.

Gold, silver, oil, natural gas, copper, and the currency contracts settle on a Pyth price. They do not use the Bitcoin average.

The scanner does this, in order:

1. Read the prints already in and compute the chance the settlement finishes on YES. Call that P. It is not a chart and it is not a feeling.
2. Sit if the chart names nothing, or names the other side. Sit if the news card is older than six hours.
3. Subtract a 2 cent cushion, the price, and the fee. What is left is the edge. A taker needs at least 4 cents of edge. A maker needs at least 1 cent and must not cross the spread.
4. Size it so the cash spent is inside the slice of the prediction balance. One order per contract.

Worked example. P is 55 percent. The ask is 40 cents. The taker fee on a 40 cent contract is about 1.7 cents (7 percent times 0.40 times 0.60). Edge is 0.55 minus 0.02 minus 0.40 minus 0.017, which is about 11 cents. That ticket is allowed. If the true chance was really 40 percent, the same ticket loses the whole 40 cents plus the fee. The cushion exists because P is a model, not a fact.

A win on a 40 cent ticket pays about 58 cents after the fee. A loss costs about 42 cents. You need the chance to be better than the price often enough that the wins pay for the losses. Risking the whole deposit on one ticket can double it or zero it. That is not the plan.

## Product 2. The perpetual

It stays open until it is closed, the stop fills, or Kalshi liquidates it. Leverage is the number on that contract. The cash you post for one contract is the contract's price divided by that leverage.

Worked example from Kalshi's own contract quotes. A Bitcoin contract quoted near $8 at 6.4x posts about $1.25. A gold contract quoted near $4 at 15x posts about $0.27. The old code refused both because it compared the quote, and then the posted cash, with a fixed $3. The quote is not the cash.

The scanner does this, in order:

1. Sit if the book is wider than 8 basis points, or funding is missing, or funding is charging that side.
2. Use the leverage printed on the contract. Do not type in 15x for Bitcoin if the contract says 6.4x.
3. Attach a stop and a target before the order is sent. Kalshi says auto-liquidation is not a stop.
4. The cash posted must sit inside the slice of the margin balance. The fixed $3 is not that slice.

A 1 percent move in the contract price, at 15x, is about a 15 percent move in the cash you posted. The fee on the Kalshi filing is 12 basis points taker and 5 basis points maker, charged on the whole contract, on the way in and the way out. On a $4 gold contract that is well under a cent each way. The danger is the move, not the fee.

## How much of the deposit one trade may use

This number is not in the code yet. Proposed, until you change it:

- One 15-minute ticket may spend at most 5 percent of the cash sitting in the prediction balance.
- One perpetual may post at most 5 percent of the cash sitting in the margin balance.
- The day stops when the deposit is down 10 percent. The next day is a new day.
- Three settled losses in a row, then 20 minutes with no new ticket. One loss does not pause.

On a $300 deposit, 5 percent is $15. That is one 40 cent ticket of about 35 contracts, or about twelve of the $1.25 Bitcoin perpetuals, or about fifty of the $0.27 gold perpetuals. Fifty gold contracts is a large position. The 5 percent cap is the brake. It is also why $300 does not become $3,000 in a week unless the edge is real and the stops fill. If you want a larger slice, say so. A 20 percent slice flips faster and can erase the deposit in five losses.

## What this page deleted

The old README said the code wins when the page disagrees. That sentence is gone. The 24-row status table is gone. The $3 order, the −$15 day, and the $9 open cap are no longer written as the rule. The line that a quiet chart sits, and the line that an old news card sits, stay, because those match the scanner above.

## What the code still does

The code still caps a 15-minute order at $3, the day at −$15, and open risk at $9. The perpetual button still caps posted margin at $3. Those numbers live in `src/lib/desk/config.ts` and `src/routes/api/live/perp-fire.ts`. They are the next files, not this one.

## Open questions

1. How many dollars is the one deposit?
2. After you move money in the Portfolio tab, how much sits in predictions and how much sits in margin?
3. Is 5 percent per trade, and 10 percent down on the day, the slice you want, or do you want a larger one?

## Code

`main` is the only line. Node 22. After a change: `bun test`, `npm run typecheck`, `npm run lint`. Do not commit secrets or anything under `data/`.
