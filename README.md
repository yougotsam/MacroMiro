# MacroMiro

The old rulebook is gone. This page is the new one. If a sentence is not here, it is not a rule.

## Account

One deposit, between $100 and $200. Kalshi keeps a prediction pile and a margin pile. They do not share cash. The bot does not move money between them. You move it in the Portfolio tab.

The bot reads the cash in the pile it is about to use. It does not assume a balance. If that cash cannot be read, it does not trade.

One trade may post at most 4% of that pile. The day stops at 8% of that same pile. There is no fixed dollar cap and no martingale.

## Before a 15-minute ticket

Direction is decided from the last closed 1-minute prices, and from nothing else.

- The 9-period average is above the 21, the previous close tagged the 9, and the latest close is back above it. Strength (RSI 14) is between 52 and 68. That is an up ticket.
- The mirror image, with strength between 32 and 48, is a down ticket.
- Anything else is no trade. A calculated chance the contract finishes in the money is not an entry.

The order rests on your side of the book. It does not cross. If the spread is wider than 4 cents, no trade. The settlement feed still has to be fresh, because a stale price is not a market. It does not choose the side.

15-minute sending is off until you turn it on. Scoring can run. Orders do not.

## Perpetuals

A buy rests on the bid. A sell rests on the ask. Cash posted is the contract price divided by that contract's leverage. The stop and the target are the ones you set on the sliders. There is no separate entry signal yet. Do not treat a click as a finished strategy. One click can still post the whole clip, and the clip should be inside the 4% rule above. The button does not yet know the margin balance, so it cannot enforce that by itself.

## What this is not

This is not a promise of profit. The averages and the strength bands are a public scalping pattern (9 and 21, with strength as the filter, enter on the retest, not on the cross). They have not been scored on this account. The old fills do not count.

## File order

1. This page.
2. `.grok/rules/trading-system.md` says the same thing in short.
3. `src/lib/desk/fresh-law.ts` is the check the 15-minute decision calls.
4. `src/lib/desk/evaluator.ts` calls that check and does not use the old chart list.
5. Sending stays off in `src/lib/desk/config.ts`.
