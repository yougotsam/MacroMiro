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
8. Price is 4¢–72¢. Anything above 72¢ is a favorite and is refused. A 20-minute-average agreement cannot approve a contract above 60¢. The chart can still nudge the chance by at most 4 points. It cannot flip a 90% settlement into the other side.
9. One ticker ≤ $3, same-direction crypto ≤ $4, everything open ≤ $9.
10. The structure side agrees with the priced side. A line cross with no structure is a sit.

Perps orders are locked. They are not sent on this path.

## Firecrawl, Spark, Alexandria

These are on `main`. They are not on another branch. They write files. The send now reads those files after the structure check (`src/lib/desk/intel-gate.ts`).

- Alexandria is a tool catalog. An empty catalog does not refuse an order.
- A stale, missing, or unclear Spark brief does not refuse an order. The price scan does not wait on it.
- A fresh bullish or bearish brief must match the side on the asset it names (bitcoin and/or gold). The other four markets are not forced to that asset's direction.
- MiroFish is read from `data/mirofish-latest.json` on the same check. A fresh completed run at or above 55% or at or below 45% must match the side. If the file says the swarm is not running, that does not invent a side and it does not block. The settlement chance is still the index versus the strike. MiroFish does not replace it.
- `scripts/spark-keep.ts` is started with the engine. It asks for a new brief at most every 6 hours, and only when research spend is allowed. You do not check the expiry.

Five weeks of Bitcoin 15-minute windows (29 Aug–27 Sep 2026, 2,764 windows) paid within about one point of the contract price. A bot that bought 95–99¢ favorites in the last 90 seconds lost 0.22¢ per contract after fees. A 92% model on a 90¢ ticket is a sit. That is the fee, not a bug.

The research spend switch lives in `data/operating-mode.json`. `FULL_STANDBY` blocks a new Spark job. `RESEARCH_PAPER` with `legacy_spark_brief` allows one.

## Last live read

Free cash on the crypto board was 19¢, with $2.32 already tied in an open contract. A normal ticket does not fit until that contract settles. A model chance near 90% with no leftover cents after the fee is a sit (`G2_no_edge_or_band`), not a send.
