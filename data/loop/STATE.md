# STATE.md — MacroMiro loop memory (generated from state.json; do not hand-edit)

updatedAt: 2026-10-21T12:14:23Z
runs: 0
openIncidents: none

## Last run
none yet

## Active lessons (0) — loaded at the start of every run

## Pending lessons (0) — NOT applied until the checker or owner approves

## Recent incidents

## Notes
- Restart 2026-10-21T11:25:12Z on de4029b. Engine pid 951, watchdog pid 8488, first status tick 9 at 11:25:21Z. errors 0.
- PRICE_MIN live: 11:25:13Z KXGBPUSD15M NO_TRADE G2_no_edge_or_band, no bid 5¢ / no ask 6¢, shadow_best null. Same book a minute earlier was no_room on the old process, which had sent no at 5¢.
- Journal prefix through the pre-restart 499 lines unchanged. Private snapshot 20261021T112708Z sha256 f07f4f17256d9793bda117e2bfee082b00ef14da6811e0d60a09ea48e18804f5.
- PR16 measurement 2026-10-21T11:49Z: settlement lag INSUFFICIENT DATA (no series-bucket has 30 confirmation rows). Post-print lag INSUFFICIENT DATA (0 events). Maker fee on the 11 series is $0 on the exchange schedule and on fills. No harvest built.
- Restart 2026-10-21T12:00:29Z on 2db8292. Engine pid 8086, watchdog pid 8488, errors 0. Journal prefix of 1354 lines unchanged. Capture pid 7689 and book recorder pid 7457 are boot-wired. 12:15 window: 11 series, one row a second, index timestamp on every row. EUR and GBP had no NO bid, so that side is null rather than invented.

## Restart

tick: engine started 2026-10-21T12:00:29Z, pid 8086, commit 2db82925616b3f80316a1f52ca0863389b411718
watchdog: pid 8488, unchanged
errors: 0
capture: pid 7689, appends data/desk/macro-capture.jsonl, first line still the 403
book: pid 7457, data/desk/book-90s.jsonl
