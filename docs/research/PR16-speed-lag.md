# PR16 measurement — fees, tape, survival

Measurement only. No order was sent. `PRICE_MIN`, caps, and gates were not edited. The running engine was not restarted.

Pre-registered before the settlement numbers were read:

- A cell is discussed only if the confirmation half has at least 30 rows. Series are never pooled.
- Older half of that series' closes is discovery. Newer half is confirmation.
- Taker fee is the exchange schedule: `quadratic`, multiplier 1, `0.07 × C × P × (1−P)`, then the desk's cent-grid ceil. Confirmed on a live BTC fill: 1 contract at 55¢, `fee_cost` $0.0173.
- This test buys the ask, so it is a taker. Maker fee is not in the edge.
- Our latency is 1.1 seconds: one loop tick plus the worst measured ack (75 ms). A fill counts only if a later row 1.1 to 2.2 seconds later still shows the same ask. Otherwise the quote is gone. No mid.
- Mispricing, as specified, means the favorite's ask plus that taker fee is under $1. That bar is weak. It is reported anyway. The harvest number is the fill at 1.1 seconds.

## Telegram

Not confirmed. There is no `data/desk/alerts.jsonl`. The watchdog sender does not store the HTTP status. This machine cannot see the phone. Nothing was sent again.

## Step 0a — fee truth, from the exchange

Pulled `2026-10-21` from `GET /trade-api/v2/series/{ticker}` and from 483 account fills (`fee_cost`, `is_taker`), 21 Sep through 21 Oct.

`KXBTCMAX125` was fetched as a control. The exchange labels it `quadratic_with_maker_fees`. All 11 of our series are `fee_type: quadratic`, `fee_multiplier: 1`. That is the field the exchange uses to say the maker does not pay the quarter-rate.

The public line "about 0.44¢ maker at 50¢" is a quarter of the 1.75¢ taker fee. It belongs to series tagged `quadratic_with_maker_fees` (the fee-schedule page's non-standard list, including `KXBTCMAX125`). It is not the schedule on these 15-minute series.

| Series | Schedule | Maker fills | Maker `fee_cost` | Taker fills | Taker `fee_cost` |
|---|---|---:|---:|---:|---:|
| KXBTC15M | quadratic × 1 | 41 | $0 | 89 | $2.66 |
| KXETH15M | quadratic × 1 | 23 | $0 | 35 | $0.59 |
| KXSOL15M | quadratic × 1 | 38 | $0.0001 | 47 | $1.06 |
| KXXRP15M | quadratic × 1 | 14 | $0 | 20 | $0.65 |
| KXDOGE15M | quadratic × 1 | 4 | $0 | 1 | $0.06 |
| KXGOLD15M | quadratic × 1 | 31 | $0 | 73 | $2.02 |
| KXSILVER15M | quadratic × 1 | 3 | $0 | 3 | $0.12 |
| KXWTI15M | quadratic × 1 | 15 | $0 | 1 | $0.03 |
| KXGBPUSD15M | quadratic × 1 | 11 | $0 | 2 | $0.02 |
| KXEURUSD15M | quadratic × 1 | 13 | $0 | 0 | — |
| KXUSDJPY15M | quadratic × 1 | 11 | $0 | 4 | $0.32 |

The only non-zero maker charges are two SOL YES fills at 9.7¢ on 20 Oct, $0.00009 and $0.00001 on 14 contracts. That is under a hundredth of a cent per contract, not 0.44¢. Maker fills before 19 Oct: 96, fee $0. On and after 19 Oct: 108, fee $0.0001, all of it those two SOL prints.

Taker fee at the middle of the book matches the formula. One BTC contract at 55¢ cost $0.0173. One at 50¢, 2.89 contracts, cost $0.0506.

Every edge below uses taker fee from that formula. Maker fee is treated as $0 on these 11 series.

## Step 0b — what is on disk

Decisions log is the top of book, one row per series per tick, not a separate order-book archive. 1-second index prints are in `data/desk/prints/`. Both exist for every series. Final minute means 3 to 60 seconds left.

| Series | Decisions | Final-minute rows | Both bids present | Span |
|---|---:|---:|---:|---|
| KXBTC15M | 6,129 | 392 | 108 | 13 Oct 20:26Z – 21 Oct 11:48Z |
| KXETH15M | 6,914 | 414 | 101 | same start |
| KXSOL15M | 6,984 | 424 | 111 | same start |
| KXXRP15M | 6,247 | 403 | 114 | same start |
| KXDOGE15M | 4,014 | 219 | 40 | 20 Oct 05:43Z – |
| KXGOLD15M | 6,312 | 353 | 189 | 13 Oct 20:26Z – |
| KXSILVER15M | 3,562 | 205 | 101 | 20 Oct 05:43Z – |
| KXWTI15M | 3,374 | 213 | 102 | 20 Oct 05:43Z – |
| KXGBPUSD15M | 5,882 | 259 | 95 | 20 Oct 04:06Z – |
| KXEURUSD15M | 6,061 | 375 | 161 | 20 Oct 04:06Z – |
| KXUSDJPY15M | 4,763 | 370 | 162 | 20 Oct 04:06Z – |

Crypto index prints: about 73,000 seconds for BTC, ETH, SOL, XRP. DOGE about 43,000, from 20 Oct. A missing second inside a settlement window drops that row. The book is sparse: most final-minute rows do not have both bids.

## Step 1 — settlement lag, crypto only

Verdict: **INSUFFICIENT DATA.** No series, in any seconds-left × prints-in cell, has 30 confirmation rows. Nothing is marked HARVESTABLE. BTC, ETH, SOL, XRP, and DOGE were scored separately. Gold, FX, and oil are not in this test; their settlement is the last print, not a 60-second average.

What the small cells already show, without promoting them:

- The weak mispricing rate is 1.0 wherever a favorite ask exists. The ask plus the taker fee was under $1. That is not an edge. A 99¢ ask passes that bar.
- Fills that were still there 1.1 seconds later, ask unchanged: 1 on BTC and 1 on SOL in the early-minute cell, and 0 in the locked cell (under 15 seconds left and 46 or more prints). Those two fills are not a sample.
- Where a median survival is under 1.1 seconds (several ETH and XRP cells, and the locked BTC/ETH cells at 0), our loop loses the race. Those cells also have confirmation n under 30, so the sentence stops there.

The largest confirmation cell is XRP, 46–60 seconds left, 0–15 prints: 28 rows. Under the bar. It is also not a locked average. The locked cell is 2 rows on BTC and 2 on ETH in confirmation.

## Step 2 — post-print lag

High-impact events on the tape with both a book and a 1-second index: **0.** The bar to say anything was 5. Verdict: **INSUFFICIENT DATA.**

BLS (CPI, payrolls, PPI) returned HTTP 403 on 17 Oct and again on this pass. Those events are not in the file. The calendar that did load has no CPI, NFP, PPI, or timed FOMC inside 13–21 Oct.

Next names on the file, not yet a sample:

| When | Name | Clock usable? |
|---|---|---|
| 2026-10-28 | FOMC rate decision | No. The source has a day and no time |
| 2026-10-29 12:30Z | GDP advance, 3rd quarter 2026 | Yes, but it is not in the CPI/NFP/FOMC/PPI list |
| 2026-10-29 12:30Z | Personal income and outlays, September 2026 | Same |

`scripts/macro-event-capture.py` only appends `data/desk/macro-capture.jsonl`. It does not import the sender. It retries the BLS calendar and, if a timed high-impact release is inside the window, writes a marker. The book and the index stay the files the desk already writes.

## Regime

The prompt says the liquidity program ended about 19 Oct 2026. The Kalshi help page fetched this pass says the program end is 1 Jan 2027, and that Kalshi can change it at any time (page updated after 8 Oct 2026). Maker `fee_cost` on our fills did not step up on 19 Oct. Either way, a book recorded while a reward pool is live is not the book after the pool stops. Every number above is provisional.

## What does not get built

No harvest. No change to who can send, or at what price.
