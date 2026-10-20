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
8. Price is 4¢–93¢. The order is sized to the cash on the crypto board, and never above $3. A $2.51 balance cannot be asked to pay $2.70.
9. One ticker ≤ $3, same-direction crypto ≤ $4, everything open ≤ $9.
10. The structure side agrees with the priced side. A line cross with no structure is a sit.

Perps orders are locked. They are not sent on this path.

## Firecrawl, Spark, Alexandria

These are on `main`. They are not on another branch. They write files. The send now reads those files after the structure check (`src/lib/desk/intel-gate.ts`).

- Alexandria must have its tool list loaded (`data/alexandria-latest.json`). An empty list refuses the order.
- Spark must be a completed Firecrawl brief newer than 6 hours (`data/spark-latest.json`). A processing or old brief refuses the order (`spark_not_ready`).
- A fresh bullish or bearish brief must match the side on the asset it names (bitcoin and/or gold). The other four markets are not forced to that asset's direction.
- MiroFish is read from `data/mirofish-latest.json` on the same check. A fresh completed run at or above 55% or at or below 45% must match the side. If the file says the swarm is not running, that does not invent a side and it does not block. The settlement chance is still the index versus the strike. MiroFish does not replace it.
- The Spark card in this commit is a completed brief. Its direction is unclear, so it does not force yes or no. A brief older than 6 hours refuses the order until a new one is written.

The research spend switch lives in `data/operating-mode.json`. `FULL_STANDBY` blocks a new Spark job. `RESEARCH_PAPER` with `legacy_spark_brief` allows one.

## Last live read

Cash on the crypto board was $2.51. That is the real size cap until the balance is higher. A model chance near 98% with no leftover cents after the fee is a sit (`G2_no_edge_or_band`), not a send.
