# STATE.md — MacroMiro loop memory (generated from state.json; do not hand-edit)

updatedAt: 2026-10-21T11:19:10Z
runs: 0
openIncidents: none

## Last run
none yet

## Active lessons (0) — loaded at the start of every run

## Pending lessons (0) — NOT applied until the checker or owner approves

## Recent incidents

## Notes
- PR16 post-print lag: high-impact events inside the tape = 0 (need 30). BLS calendar HTTP 403, 0 events. No BEA/FOMC print from 2026-10-13 through 2026-10-21. No lag and no dollars.
- PR16 settlement lag: 43 crypto closes, 270 settled bucket-rows, 1,328 of 1,793 final-minute rows had no favorite ask. Locked bucket (3-15s left, 46-60 prints) = 6 rows / 5 windows. Not a candidate.
- PR16 early final minute (46-60s left, 0-15 prints): 97 rows / 39 windows, median ask 99.5¢, OOS window-mean +1.7¢. Independent OOS windows = 19 < 30. Not a candidate.
- Fee path: live journal 30 fills, 7 fee-verified, 23 unknown. Cancel-throw fee write is commit de4029b and is not loaded. 07:30 ET window was still open; journal not rewritten.

## PR16 counts (2026-10-21, research only, orders not touched)

Post-print lag. High-impact events on the tape: 0. Bar for a conclusion: 30. BLS feed returned HTTP 403 and contributed 0 events. Calendar fetch 2026-10-17. No event in 2026-10-13..21.

Settlement lag, crypto, one row per contract per bucket, settled windows only.

| Bucket | Rows | Windows | OOS windows | OOS mean pnl | Candidate |
|---|---:|---:|---:|---:|---|
| 46-60s left, 0-15 prints | 97 | 39 | 19 | +0.017 | no (under 30 windows; median ask 99.5¢) |
| 31-45s left, 0-15 prints | 84 | — | 40 rows | -0.006 | no |
| 16-30s left, 31-45 prints | 42 | — | 17 rows | +0.013 | no |
| 3-15s left, 46-60 prints | 6 | 5 | 2 | +0.348 | no (one 41¢ DOGE) |

Final-minute crypto decision rows: 1,793. No usable favorite ask: 1,328. Print gaps: 53.
Full writeup: docs/research/PR16-speed-lag.md
