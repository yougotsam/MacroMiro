# MacroMiro AURIX-X Coding Agent Instructions
Branch from `desk-brain-mirofish`, never work on `main` by assumption.
The single strategy specification is `docs/STRATEGY.md`, with implementation
and blockers in `docs/AURIX_RELEASE_REPORT.md`.

Do not invent price, volume, settlement prints or unverified probabilities.
`src/lib/desk/oms.ts` is the only signed order writer. Keep
`CALIBRATED_MODEL_APPROVED=false` until an independently reviewed model
release demonstrates out-of-sample after-cost profitability, required live
data validity and order/risk integration tests. Kalshi perps are separate
and disabled.

Run installed project tests, TypeScript typecheck, lint and end-to-end demo
tests; explicitly report failures. Never claim live trading is enabled.
Respect unrelated user features; do not delete NFC/transit code.
