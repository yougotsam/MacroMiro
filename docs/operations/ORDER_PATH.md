# Order path (what can still stop a trade)

The only process that sends a Kalshi order is `scripts/desk-engine.ts`.
The web page does not send orders. `scripts/heart-worker.sh` only refreshes the screen.

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
2. No resting order on that ticker, and no position on the other side.
3. No fast-move freeze in the last 10 seconds.
4. Live, begin, and arm files are each the character `1`.
5. Watchdog pulse is fresh.
6. Account snapshot is fresh and the exchange is open.
7. Today's worst case is still above −$15. The stop is dollars, not a count of losses. A new ET day clears the prior day's latch.
8. Price is 21¢–72¢. At or under 20¢ is refused: on the 28 fills through 21 Oct 2026 that bucket was 1 win and 9 losses, about −$10.58 after estimated taker fees. That cut is in-sample and small. Anything above 72¢ is a favorite and is refused. Being past the 20-minute average is not an entry at any price. A trade can come from an RSI wick, a fib pocket with a wick or a gap, a liquidity sweep, a demand or supply candle, price back inside a gap, or a sniper price setup on that same side. The sniper cannot cancel one. The chart can nudge the chance by at most 4 points. It cannot flip the side.
9. One ticker ≤ $3, same-direction crypto ≤ $4, everything open ≤ $9. If that room is under one contract, the currency markets sit on `no_room` before any order is sent.
10. The structure side agrees with the priced side. A line cross with no structure is a sit.
11. A currency ticket files on shard 0. If that board is short, the order moves event-contract cash from shard 2 first. The body must name `source` and `destination` as `event_contract`. A blank source is a 400 and the order is not sent.

Perps orders are locked. They are not sent on this path.

## Firecrawl, Spark, Alexandria

These are on `main`. They are not on another branch. They write files. The send now reads those files after the structure check (`src/lib/desk/intel-gate.ts`).

- Alexandria is a tool catalog. An empty catalog does not refuse an order.
- A stale, missing, or unclear Spark brief does not refuse an order. The price scan does not wait on it.
- A Spark brief is written onto the reason. A bearish brief does not cancel a yes. A scheduled CPI, jobs, or Fed print does not sit the book either. Spark was built to read the news, not to turn the desk off.
- MiroFish is read from `data/mirofish-latest.json`. A fresh number is a note. It does not cancel, and it is not the settlement chance. If the file says the swarm is not running, that does not invent a side.
- `scripts/spark-keep.ts` is started with the engine. It asks for a new brief at most every 6 hours, and only when research spend is allowed. You do not check the expiry.

Five weeks of Bitcoin 15-minute windows (29 Aug–27 Sep 2026, 2,764 windows) paid within about one point of the contract price. A bot that bought 95–99¢ favorites in the last 90 seconds lost 0.22¢ per contract after fees. A 92% model on a 90¢ ticket is a sit. That is the fee, not a bug.

The research spend switch lives in `data/operating-mode.json`. `FULL_STANDBY` blocks a new Spark job. `RESEARCH_PAPER` with `legacy_spark_brief` allows one.

## Last live read

2026-10-20 06:09 UTC. A $0.50 event-contract move from shard 2 to shard 0 returned 200 and then `complete`. Shard 0 went from $0.20 to $0.70. Shard 2 went from $2.09 to $1.59. The currency cash move works.

The currency tickets were still not sent. Open risk was $8.71 of the $9 cap, so the room left was $0.29, which is under one contract. Pound was also a 97¢ favorite, which is outside the 72¢ band. That is the cap, not a broken currency order.
