# Continue this desk. Work order, not a trading rule.

Repo: https://github.com/yougotsam/MacroMiro
Branch: `main` only.
Start at commit `e855953dbc86803f84b2fd16444aa81ee4056d4b` or any later commit whose message is this file.
Do not check out another branch. Do not use `docs/archive/`. Do not use `attachments/`. Do not paste or store the Kalshi private key. Do not score the old fills.

Read, in order: `README.md`, the trading section at the bottom of `AGENTS.md`, `AGENTS.project.md`. `docs/STRATEGY.md` is a pointer, not a rule.

## Goal

One bot. One deposit. Two Kalshi products: 15-minute contracts and perpetuals. Kalshi keeps two balances. They do not spend each other. Cash moves in the Portfolio tab. This repo does not move it. The aim is an aggressive flip of a few hundred dollars. That is the aim, not a promise.

## Already on main

- The README, the trading section of `AGENTS.md`, `AGENTS.project.md`, and a stub `docs/STRATEGY.md`.
- Perpetual button: a buy rests on the bid, a sell rests on the ask, size is the clip, stop and target are the sliders, the paper heartbeat is not required, the fixed $3 check is off that button. Files: `src/components/envelope.tsx`, `src/routes/api/live/perp-fire.ts`, `src/lib/perps/oms.ts`, `src/lib/perps/live-transport.ts`.

## Do not invent

The operator has not chosen: the deposit amount, the split between the two balances, when a 15-minute ticket is bought, when it is sold, when a perpetual is opened, what closes it, or how much one trade may lose. Leave those blank. Ask. Do not copy a number out of an old file or a chat attachment.

## Rewrite next, in this order

The 15-minute path still enforces the old caps and the old sits. The pages say those are not rules. The code was not changed.

1. `src/lib/desk/config.ts` — still −$15, $9, $3, $3, $4, 36¢–95¢, one order per window, 20-minute pause.
2. `src/lib/desk/risk.ts` — still enforces those numbers, and still requires the paper heartbeat before a 15-minute order.
3. `src/lib/desk/evaluator.ts` — still sits on a quiet chart, a missing 200-bar average, an upper wick on an up bet, and a lower wick on a down bet. A comment says a stale news card does not sit the ticket. `intel-gate.ts` returns `spark_stale` and this file sits. Fix the lie when you touch the file. Do not invent a replacement entry.
4. `src/lib/desk/intel-gate.ts` — a missing or old Spark card sits every 15-minute ticket. The refresh inside the gate cannot save the ticket it just blocked.
5. `src/lib/desk/gate.ts` — still prices a side with the old chance-minus-price-minus-fee formula. That formula is not a decided rule.
6. `src/lib/desk/oms.ts` — still the only 15-minute signer. Still one order per contract. It can move cash between prediction shards. That is not the perpetual margin account.
7. `src/lib/desk/engine.ts` — still sends whatever the evaluator leaves standing.

## Perpetual holes, still open

- `src/lib/scan/perp-desk.ts` `perpDecision` is not called by the button or the engine. Tests call it. Do not pretend it is live.
- A resting order can never fill. An order that is allowed to cross is not built.
- `src/routes/api/live/perp-fire.ts` has no day stop. One click can post the whole clip.
- An empty margin balance rejects a perpetual even when the prediction balance has cash.

## Docs that still describe the old caps as the rule

Rewrite or mark them after the code, not before: `docs/operations/RISK_MANDATES.md`, `docs/operations/ORDER_PATH.md`, `docs/operations/BUILD_TO_BOT_HANDOFF.md`, `docs/operations/PROBABILITY_MATRIX.md`, `docs/architecture/SYSTEM_MAP.md`, `docs/strategies/STRATEGY_REGISTRY.md`, `docs/strategies/EVIDENCE_GATE.md`, `docs/LAUNCH_GUIDE.md`, `docs/product/PRD-v0.1-source.md`.

`docs/archive/` stays history. It does not win.

## Done when

The 15-minute path no longer enforces a number the README deleted, the perpetual scanner is either wired or deleted, and every page above matches the code. No new entry rule unless the operator wrote it in this file first.
