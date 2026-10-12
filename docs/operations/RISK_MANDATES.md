# Risk mandates (per venue)
## Kalshi 15m YES/NO: APPROVED by owner (enforced in `src/lib/desk/config.ts` + `risk.ts`)
Daily stop −$15 · max open risk $9 · max $3 per order · max $4 per ticker · correlated-exposure cap · price band · snapshot stale after 20 s · max 3 orders per ticker window, 1 per tick. Live sending also needs `CALIBRATED_MODEL_APPROVED=true` (currently **false**) plus the operator mode.

## Kalshi perps: PROPOSED, NOT APPROVED (orders locked: `PERPS_ORDERS_LOCKED=true`)
| Rule | Proposed value |
|---|---|
| Account equity cap | $100 max in the margin account (owner deposits; the bot never transfers) |
| Markets | BTC, ETH, GOLD first; others only after 2B paper evidence |
| Max leverage used | 3× effective (notional ≤ 3 × equity), even though the venue allows up to ~15× |
| Risk per trade | ≤ $1 at the stop (stop always resting as a native trigger, reduce_only) |
| Max notional per position | $100 |
| Max open positions | 2, at most 1 per correlated group (crypto majors count as one group) |
| Daily stop | −$5 realized + unrealized, then flatten and halt until the next UTC day |
| Weekly stop | −$15, then halt until the owner re-approves |
| Entries | post_only maker only. Taker only for stop/exit. |
| Funding | skip when expected funding against us over the hold > 0.05% |
| Depth | top-of-book size ≥ 3× our size |
| Liquidation distance | stop must sit at ≤ 50% of the distance to the liquidation price |
| Time | no new entries 30 min before/after maintenance or funding prints, or tier-1 macro events |
| Kill switch | `cancelAll` + flatten via reduce_only. Triggered by the operator switch, a stale feed (> 10 s), or a reconcile mismatch. |
| Activation | separate written owner approval + safety checklist PASS on the perps path |
