# Order path (what can still stop a trade)

The perpetual button is not this engine. `POST /api/live/perp-fire` calls `mayFire` in `src/lib/perps/flip-plan.ts` first. A click with no sweep and no gap is refused. The stop may lose 15% of the pile. Three losses in a row end the day. Down 25% and the account stops. The seven names are Bitcoin, Ether, Solana, XRP, gold, silver, and the S&P.

The 15-minute engine below is a separate door. It does not send a perpetual. Its dollar notes are the old research record, not the perpetual plan.

The only process that sends a Kalshi 15-minute order is `scripts/desk-engine.ts`.
The web page does not send those orders. `scripts/heart-worker.sh` only refreshes the screen.

## Start

`/usr/bin/bun` in this environment is a 0-byte file. A start that uses it exits immediately and never writes a watchdog pulse. The risk door then refuses every new order.

Use a real binary. `scripts/desk-engine.sh` picks one. Direct start:

```
/usr/lib/node_modules/bun/node_modules/@oven/bun-linux-x64/bin/bun scripts/loop/watchdog.ts
/usr/lib/node_modules/bun/node_modules/@oven/bun-linux-x64/bin/bun scripts/desk-engine.ts
```

The watchdog must be running. Its pulse is `data/loop/watchdog-heartbeat.json`. Older than 3 minutes, or missing, and the engine still scans but will not send.

## After a market looks good

A quote is not an order. It still has to pass, in this order:

1. It is the best of the five this second. The others are logged and skipped.
2. No resting order on that ticker, and no position on the other side. A second send on a contract that already has a journal intent is refused, even when the exchange list has not caught up.
3. No fast-move freeze in the last 10 seconds.
4. Live, begin, and arm files are each the character `1`.
5. Watchdog pulse is fresh.
6. Account snapshot is fresh and the exchange is open.
7. Today's worst case is still above −$15. The stop is dollars, not a count of losses. A new ET day clears the prior day's latch.
8. Price is 36¢–95¢. Under 36¢ is refused. Above 95¢ is refused. A chart that names nothing sits. A chart that names the other side sits. An old or missing Spark card sits. Three settled losses in a row block new orders for 20 minutes from the third settlement. One contract, one live order.
9. One ticker ≤ $3, same-direction crypto ≤ $4, everything open ≤ $9. If that room is under one contract, the currency markets sit on `no_room` before any order is sent.
10. The structure side agrees with the priced side. A chart that names nothing sits. The last closed 1-minute price must sit on the same side of the 200 EMA as the order. If the 200 EMA is not ready, the ticket sits.
11. A currency ticket files on shard 0. If that board is short, the order moves event-contract cash from shard 2 first. The body must name `source` and `destination` as `event_contract`. A blank source is a 400 and the order is not sent.

The 15-minute engine does not send a perpetual. A perpetual leaves through `POST /api/live/perp-fire`, on the margin account, with the contract's own leverage and a stop plan. The dollar cap on that button is $3. `PERPS_ORDERS_LOCKED` is false. `lockedTransport` still throws. The live sender is `live-transport.ts`.

## Firecrawl, Spark, Alexandria

These are on `main`. They write files. The send reads those files after the structure check (`src/lib/desk/intel-gate.ts`).

- Alexandria is a tool catalog. An empty catalog does not refuse an order.
- A stale, missing, or unclear Spark brief does not refuse an order. The price scan does not wait on it.
- A fresh brief that covers the series does. Bearish sits a YES. Bullish sits a NO. A quoted probability under 0.42 against YES, or over 0.58 against NO, sits the ticket. A major CPI, jobs, or Fed print with an explicit timestamp sits new tickets from 30 minutes before until 15 minutes after (`scheduledVeto` in `macro-calendar.ts`).
- MiroFish is read from `data/mirofish-latest.json`. It is not the settlement chance. A fresh probability at or under 0.45 sits a YES. At or over 0.55 it sits a NO. Down, stale, flat, or missing does not invent a side and does not sit the book.
- `scripts/spark-keep.ts` is started with the engine. It asks for a new brief at most every 6 hours, and only when research spend is allowed.

Five weeks of Bitcoin 15-minute windows (29 Aug–27 Sep 2026, 2,764 windows) paid within about one point of the contract price. A bot that bought 95–99¢ favorites in the last 90 seconds lost 0.22¢ per contract after fees. A 92% model on a 90¢ ticket is a sit unless the edge after the 2¢ haircut and the fee still clears 4¢ as a taker or 1¢ as a maker. The price cap is 95¢. That is the fee, not a bug.

The research spend switch lives in `data/operating-mode.json`. `FULL_STANDBY` blocks a new Spark job. `RESEARCH_PAPER` with `legacy_spark_brief` allows one.

## Last live read

2026-10-20 06:09 UTC. A $0.50 event-contract move from shard 2 to shard 0 returned 200 and then `complete`. Shard 0 went from $0.20 to $0.70. Shard 2 went from $2.09 to $1.59. The currency cash move works.

The currency tickets were still not sent. Open risk was $8.71 of the $9 cap, so the room left was $0.29, which is under one contract. Pound was also a 97¢ favorite. 97¢ is above the live 95¢ cap. That is the cap, not a broken currency order.
