---
name: envelope-desk
description: >
  The live Kalshi 15-minute desk. Use when changing orders, the scan, or the
  cash move. The sender is src/lib/desk, not src/lib/scan/edge.ts.
---

# Envelope desk

One sender: `scripts/desk-engine.ts` → `src/lib/desk/oms.ts`. Do not put a second order path back in `src/lib/scan/edge.ts`.

## Markets and cash

Eleven tickets, one pile of dollars: BTC, ETH, SOL, XRP, DOGE, gold, silver, oil, GBP, EUR, JPY.
Crypto, metals, and oil file on shard 2. The three currencies file on shard 0.
Both are event contracts. A currency order moves the cost first:

`source` and `destination` must be `event_contract`. The shard numbers say which board.
Amount is centicents. A blank `source` is a 400. This was proven with a $0.50 move on 2026-10-20 (`transfer_id` 635fc080).

## What can refuse a ticket

Price 4¢–72¢. Day stop −$15. One ticker ≤ $3. Same-direction crypto ≤ $4. Everything open ≤ $9.
Do not raise those numbers in a drive-by. If open risk is already near $9, a currency ticket sits on `no_room` even when the cash move works.
A line cross is not an entry. Ways in: RSI wick, fib pocket with a wick or a gap, sweep, demand or supply, price back inside a gap, or a sniper price setup. The sniper cannot cancel a trade.
Spark and a scheduled news print are notes. They do not cancel a ticket. A missing MiroFish run cannot. Alexandria is a catalog, not a side.

## Do not

Do not send perps from this cash. Do not invent a MiroFish percent. Do not treat the 20-minute average as an entry.
