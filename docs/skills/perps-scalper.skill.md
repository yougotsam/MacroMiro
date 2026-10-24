# perps-scalper (skill file, schema: src/lib/loop/schema.ts SkillFile)

## Goal
Find Kalshi perps scalps (BTC, ETH, GOLD first) whose after-cost expectancy is positive; paper/demo only until the owner approves live.

## Rules
- The live path is `POST /api/live/perp-fire`. It needs the three desk switches, the contract's leverage, and a stop. `PERPS_ORDERS_LOCKED` is false. `order-adapter.ts` does not send.
- Only trade a candidate the code engine already qualified (setup present, data ready, stop defined).
- Skip when the net-if-win is not clearly larger than the net-if-loss after fees and funding.
- Never reverse an open position; exits are reduce-only.
- Respect every ACTIVE lesson loaded at the start of the run.
- The checker grades only the trade log; reasoning is never shown to it.

## Lessons
- Seeded at run time from lessons.jsonl (active only). Pending lessons are not applied.

## Regime tags
trend_up, trend_down, range, high_vol
