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

The stop this repo sends is a Kalshi exit trigger: a stop price and a target, tied to the perpetual order. The live button passes the contract's own leverage and that stop. Cancel, positions, and fills on the margin account are real reads. An empty list means Kalshi returned none.

A perpetual lean can send when the book is tighter than 8 bps, funding is known, and funding is not charging that side. It uses the leverage number on that perpetual contract. A 15-minute contract does not have leverage and does not use this path.

## What the code does today

The 15-minute engine sends only when `kalshi_live`, `kalshi_begin`, and `desk_arm` are all on, the day stop is not latched, and the price check plus the risk check both pass.

- Price must be from 36¢ to 95¢. Under 36¢ is refused. Over 95¢ is refused. The chance still has to beat the price and the fee. That band is the current setting. It is not a backtest result.
- `CALIBRATED_MODEL_APPROVED` is on. `APPROVAL_POLICY_ENFORCED` is off, so the extra approval result is computed and then ignored, and a taker order is allowed.
- A chart that names nothing sits. A chart that names the other side sits. An upper wick sits an up bet. A lower wick sits a down bet. A missing long average, built from about three and a half hours of one-minute prints, still sits the ticket. After a restart that average is empty until the prints come back.
- A fresh note that disagrees can sit a ticket. A stale or missing note also sits the ticket. The news job still does not wait, so a ticket with no fresh note does not go out.
- Three losses in a row pause new 15-minute orders for 20 minutes. One contract, one live order. The order size cannot spend more than $3, the −$15 day, or the $9 open cap.
- Meme coins are not on this order path. No pair is approved. There is no wallet and no swap.

## File track

Two products. One repo. Leverage belongs only to the perpetual.

| # | File | Where it stands |
|---|---|---|
| 1 | README.md | This page. |
| 2 | docs/STRATEGY.md | Quiet chart sits. The old fill story is out. |
| 3 | src/lib/desk/config.ts | 36¢–95¢, −$15 day, $3 order. Approval switch is off. |
| 4 | src/lib/desk/gate.ts | Prices the 15-minute ticket. Does not touch a perpetual. |
| 5 | src/lib/desk/risk.ts | Dollar caps in front of a 15-minute send. |
| 6 | src/lib/desk/oms.ts | The only signer for a 15-minute order. |
| 7 | src/lib/desk/evaluator.ts | A quiet chart sits. An upper wick sits only the up bet. |
| 8 | src/lib/desk/intelligence.ts | A note can shrink a chance. It does not send. |
| 9 | src/lib/desk/intel-gate.ts | An old or missing Spark card sits the 15-minute ticket. |
| 10 | src/lib/desk/features.ts | The long average. Unread means the ticket sits. |
| 11 | src/lib/desk/settlement.ts | Crypto uses 60 prints. Gold and currencies do not. |
| 12 | src/lib/perps/live-transport.ts | Cancel, positions, fills, and the stop, on the margin account. |
| 13 | src/lib/perps/oms.ts | A perpetual entry with a plan attaches the stop. |
| 14 | src/lib/perps/manage.ts | Stop, target, and the half-size target. |
| 15 | src/lib/scan/perp-desk.ts | Uses the leverage on that perpetual. A pass may send. |
| 16 | src/routes/api/live/perp-fire.ts | The perpetual button. Requires leverage and attaches the stop. |
| 17 | src/components/envelope.tsx | The button sends the contract's leverage. |
| 18 | docs/operations/ORDER_PATH.md | Says the two paths apart. |
| 19 | docs/operations/RISK_MANDATES.md | $3 clip on the perpetual button. No leverage on a 15-minute contract. |
| 20 | docs/architecture/SYSTEM_MAP.md | The live sender is named. The old locked row is gone. |
| 21 | docs/strategies/EXECUTION_EVAL.md | A candle replay is still not a fill. |
| 22 | AGENTS.project.md | Perpetuals are not described as locked. |
| 23 | docs/operations/BUILD_TO_BOT_HANDOFF.md | The old "locked" lines are gone. |
| 24 | docs/skills/perps-scalper.skill.md | Points at the live button. |

`src/lib/perps/order-adapter.ts` used to answer "ok" without sending. It now throws. `docs/archive/` is old paper. It does not win over this table.

## What this repo will not become

A feeling is not an entry. Fear, greed, and a headline are not a side. The measurable version of a crowd is the funding rate and the book, with a timestamp. If those numbers are missing, the perpetual sits.

A 15-minute contract is a coin flip against a published average. A story about the Fed does not settle it. The calendar can only sit the ticket around a scheduled print. It cannot raise the chance.

Other people's bots are not a strategy we copy. The public meme-bot business is mostly a fee charged to the user, or a race measured in milliseconds that this process does not run. This repo will not buy a token because a website was paid to promote it.

## Code

`main` is the only line. Node 22. After a change: `bun test`, `npm run typecheck`, `npm run lint`. Do not commit secrets or anything under `data/`.
