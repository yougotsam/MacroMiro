# PR16 — speed versus longshots

Research only. No order was sent. No gate, cap, or size was changed. The live process was not restarted.

Question: after a macro print, or after the crypto average is already decided, does the book stay cheap long enough to pay more than the fee?

Tape used: `data/desk/prints/2026-10-13` through `2026-10-21` (1-second index), `data/desk/decisions.jsonl` (book, as logged), `data/desk/outcomes.jsonl`, `data/macro-calendar.json` fetched `2026-10-17T11:13:35Z`. Nothing after the last close on disk (`2026-10-21T11:15:00Z`) is in the score.

Fee used, one contract, the desk's own rounding: `0.07 × price × (1 − price)`, then the cent-grid ceil in `src/lib/desk/fees.ts`. Maker fee is not assumed. A harvest that has to cross is a taker.

A bucket is a candidate only if both halves of a time split are positive after that fee, the out-of-sample half stays positive after another 1¢ of slippage, and the out-of-sample half has at least 30 independent windows. Thirty rows of the same clock do not count as 30.

## 1. Post-print lag

High-impact means the same names the desk already treats as major: CPI, consumer price, FOMC, the funds rate, nonfarm payrolls, the employment situation, PPI. That list is the regex in `src/lib/desk/macro-calendar.ts`.

| Fact | Count |
|---|---|
| Calendar events stored | 220 |
| BLS events (CPI, payrolls, PPI) | 0. The ICS fetch returned HTTP 403 |
| BEA events | 166 |
| Fed events | 54. FOMC is a day, not a clock time |
| High-impact events whose clock falls inside the tape (13–21 Oct 2026) | 0 |

The nearest names are a BEA trade report on 6 Oct (before the tape), FOMC day on 28 Oct with no time, and GDP plus personal income on 29 Oct (after the tape). None of those have a book to measure.

No seconds of lag. No edge. No dollars. The bar was 30 events. The sample is 0. There is no conclusion, and none will be invented from the other 220 releases.

What would be measured once a CPI or payrolls actually lands on a recorded book: seconds from the index jump until the favorite's ask moves at least 1¢ off the pre-print ask, and whether that stale ask still clears the fee against the settlement. Until BLS is on the calendar, this test cannot start. The desk already refuses to trust that file (`official_source_unverified_BLS`).

## 2. Settlement lag, crypto only

BTC, ETH, SOL, XRP, DOGE. The contract pays the average of 60 one-second prints. A row is the first logged book in that window inside one cell of seconds-left × prints-in. Prints are counted from the index file. A missing second inside the window drops the row (53 did). The favorite is the side of that partial average, with seconds still missing filled by the last print, the same construction as `cryptoProb`. The ask is that side's ask. The score is the settlement, not the model's confidence.

| | |
|---|---|
| Decision rows read | 57,035 |
| Crypto rows with 3–60s left | 1,793 |
| No usable ask on the favorite | 1,328 (74%) |
| Rows kept, one per contract per cell | 270 |
| Distinct 15-minute closes | 43 |
| Span | 2026-10-13 20:30Z through 2026-10-21 11:15Z |
| Out-of-sample cut | closes at or after 2026-10-20 05:45Z |

You cannot have 46 prints in with 46 seconds still left. The only cells that can be full are the diagonal: early minute with few prints, late minute with many prints.

| Bucket | Rows | What it is | Hit | Mean pnl / contract | Out of sample | Candidate |
|---|---:|---|---:|---:|---|---|
| 46–60s left, 0–15 prints | 97 | not locked; last price projected | 94.8% | +1.3¢ | 46 rows, 19 windows, window-mean +1.7¢ | no |
| 31–45s left, 0–15 prints | 84 | still mostly a projection | 92.9% | −1.4¢ | 40 rows, mean −0.6¢ | no |
| 31–45s left, 16–30 prints | 24 | partial | 95.8% | +10.9¢ | 11 rows | no |
| 16–30s left, 16–30 prints | 15 | partial | 86.7% | −4.1¢ | 4 rows | no |
| 16–30s left, 31–45 prints | 42 | partial | 97.6% | +3.3¢ | 17 rows, mean +1.3¢ | no |
| 3–15s left, 31–45 prints | 2 | almost locked | 2/2 | +40.5¢ | 1 row | no |
| 3–15s left, 46–60 prints | 6 | the average is nearly a fact | 6/6 | +14.6¢ | 2 windows | no |

The early cell is the only one with a positive out-of-sample mean and a large row count. It is not a candidate. Nineteen windows is under 30. The median ask is 99.5¢. Sixty-nine of the 97 asks are 95¢ or higher. A win at 99.5¢ pays less than the fee is worth worrying about; the +1.7¢ average is a few cheap asks, not the typical quote. After 1¢ of slippage the row-level out-of-sample mean was +0.5¢. That is not a trade.

The locked cell, 46 or more prints and under 15 seconds, is the actual speed question. Six contracts, five windows, all six won. Two are out of sample. One of those two is DOGE YES at 41¢ (`2026-10-20T08:00Z`, +57¢). The other is BTC YES at 87¢ (+12¢). The in-sample locked asks were 94¢, 95.6¢, 90.9¢, and 99.9¢. One stale 41¢ ask is an anecdote. It is not a bucket.

By series, pooling every final-minute cell: BTC's out-of-sample mean is negative (−3.2¢, 34 rows). No series has 30 out-of-sample windows inside the locked cell. None is a candidate.

## What the book actually did

Most of the time there is nothing to hit. Three quarters of the final-minute rows had no ask on the side the average favored. When the average is still a projection, the quote that does exist is usually 95–99¢. When the average is decided, the sample is six contracts. Speed is only worth money if a quote is still open below the payoff by more than the fee. On this tape that happened too rarely to price.

Longshots are the other test, already in the journal, not repeated here: the contracts bought at or under 20¢ were the losing bucket. This file does not move that rule. It also does not turn the six locked wins into a strategy.

## Fees, not a new order

The running engine's own line at 11:17Z: 30 journal fills, 7 with an exchange fee, 23 without. The cancel path that writes the fee after http 0 is commit `de4029b` on `research/profitability-maker-taker-improvements`. That process has not been restarted, so the running desk does not have it.

The 07:30 ET window was still open while this was written (DOGE resting, open worst $2.70). The live journal was not rewritten. Appending fees under a process that is also appending would race. When that window is settled, the fee still will not appear on a failed cancel until the desk is loaded from `de4029b`.

## Not claimed

No post-print edge. No settlement-lag edge. No change to expectancy from this file. The next CPI or payrolls that arrives while the index and the book are both recording is the first observation of test 1, not the thirty-first.
