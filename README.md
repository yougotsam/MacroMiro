# MacroMiro

Two Kalshi products. Two balances. They do not share cash. A perpetual liquidation cannot spend the prediction balance, and a 15-minute loss cannot liquidate a perpetual. Kalshi's help center says the prediction account and the margin account are regulated separately. This repo can read both. It does not move money between them.

Nothing on this page is a claim that a rule makes money. If this page disagrees with the code, the code wins.

## How a 15-minute contract settles

You are not betting on the last price you see.

A crypto 15-minute contract, such as Bitcoin, settles YES when the average of 60 one-second CF Benchmarks prints in the final minute is at or above the same kind of average from the start of the window. One late spike does not settle it. The official index is not Coinbase's last trade.

Gold, silver, oil, natural gas, copper, and the currency 15-minute contracts settle on a Pyth price, not on that crypto average. Do not use the Bitcoin rule on gold.

The chance the code computes is only: given the prints already in, how likely is that average to finish on this side. It is not a chart setup. It is not a reason to pay the spread by itself.

## How a perpetual works

A perpetual does not die at the end of 15 minutes. It tracks the asset until you close it, you get liquidated, or you attach a stop that actually fires.

Funding is the rent for holding it. Kalshi computes it from the gap between the perpetual and spot, and charges it at 12:00 AM, 8:00 AM, and 4:00 PM ET. If the perpetual is above spot, longs pay shorts. If it is below, shorts pay longs. The rate is capped at 2% per window. A rate smaller than 0.01% is treated as zero. Funding is a cost, not a signal that the next window will repeat.

Leverage shrinks the cash you post and moves the liquidation price closer to your entry. Kalshi's own perpetual pages say auto-liquidation is not a guaranteed stop. It can close you without notice, and it is not the stop this repo attaches.

The stop this repo can send is a Kalshi exit trigger: a stop price and a target, tied to the order. It is sent only when the order carries a plan. The live button does not carry a plan, so a button press still has no stop. Cancel, positions, and fills on the margin account are real reads. An empty list means Kalshi returned none.

The perpetual scanner does not send. It can describe a three-minute push. That push does not look at funding or at how thick the book is.

## What the code does today

The 15-minute engine sends only when `kalshi_live`, `kalshi_begin`, and `desk_arm` are all on, the day stop is not latched, and the price check plus the risk check both pass.

- Price must be from 36¢ to 95¢. Under 36¢ is refused. Over 95¢ is refused. The chance still has to beat the price and the fee. That band is the current setting. It is not a backtest result.
- `CALIBRATED_MODEL_APPROVED` is on. `APPROVAL_POLICY_ENFORCED` is off, so the extra approval result is computed and then ignored, and a taker order is allowed.
- A chart that names nothing sits. A chart that names the other side sits. An upper wick sits an up bet. A lower wick sits a down bet. A missing long average, built from about three and a half hours of one-minute prints, still sits the ticket. After a restart that average is empty until the prints come back.
- A fresh note that disagrees can sit a ticket. A stale or missing note also sits the ticket. The news job still does not wait, so a ticket with no fresh note does not go out.
- Three losses in a row pause new 15-minute orders for 20 minutes. One contract, one live order. The order size cannot spend more than $3, the −$15 day, or the $9 open cap.
- Meme coins are not on this order path. No pair is approved. There is no wallet and no swap.

## What changes next, and only after you approve the file

This page does not turn those switches. The decision files are still the old behavior until each one is approved.

1. `docs/STRATEGY.md` — say the same settlement rules as this page. Remove any sentence that treats old fills as proof.
2. `src/lib/desk/config.ts` — keep the band and the caps visible in one place. Do not flip the approval switch until that file's turn says what it refuses.
3. `src/lib/desk/evaluator.ts` — done. A quiet chart sits. An upper wick sits only the up bet.
4. `src/lib/desk/gate.ts` — a taker pays the fee and the spread. A maker does not get to cross.
5. `src/lib/desk/settlement.ts` — crypto uses the 60-print average. Gold and currencies do not borrow that formula.
6. `src/lib/desk/features.ts` — the long average must have a source that survives a restart, or the ticket sits.
7. `src/lib/desk/intel-gate.ts` — done for the stale note. An old or missing Spark card sits the ticket. The job still starts after a pass, so it cannot rescue the ticket it just blocked.
8. `src/lib/desk/intelligence.ts` — a note can shrink the chance. It cannot invent one.
9. `src/lib/desk/risk.ts` — dollar caps stay in front of every send, including a perpetual.
10. `src/lib/desk/oms.ts` — the only signer for a write.
11. `src/lib/perps/live-transport.ts` — already talks to cancel, positions, fills, and the stop route. Review it. Do not rewrite it to look busy.
12. `src/lib/perps/oms.ts` — an order with a plan attaches the stop. A refused stop is written down. The order is not pretended to be unsent.
13. `src/lib/perps/manage.ts` — one stop and one target on the entry. The half-size target waits until a position exists. The trail is a separate order.
14. `src/lib/scan/perp-desk.ts` — done as a lean only. Spread over 8 bps sits. Missing funding sits. Funding that charges this side sits. Leverage is capped at 5x, under the 6.8x Bitcoin max shown on Kalshi on 24 Oct 2026. It still does not send.
15. `docs/operations/RISK_MANDATES.md` — the −$15 day, the $3 order, and the separate margin account, in one page.

## What this repo will not become

A feeling is not an entry. Fear, greed, and a headline are not a side. The measurable version of a crowd is the funding rate and the book, with a timestamp. If those numbers are missing, the perpetual sits.

A 15-minute contract is a coin flip against a published average. A story about the Fed does not settle it. The calendar can only sit the ticket around a scheduled print. It cannot raise the chance.

Other people's bots are not a strategy we copy. The public meme-bot business is mostly a fee charged to the user, or a race measured in milliseconds that this process does not run. This repo will not buy a token because a website was paid to promote it.

## Code

`main` is the only line. Node 22. After a change: `bun test`, `npm run typecheck`, `npm run lint`. Do not commit secrets or anything under `data/`.
