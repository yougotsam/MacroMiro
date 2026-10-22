# MacroMiro — AURIX-X Kalshi Desk

**Current trading state: the 15-minute rule is loaded. It sends when `kalshi_live`, `kalshi_begin`, and `desk_arm` are all on.** `CALIBRATED_MODEL_APPROVED` is `true`. Perpetual orders stay off. Meme coins are not on this order path.

Scored rules that are on, as of 21 Oct 2026:

- Buy from 18¢ to 72¢. 18¢–38¢ is the favored misprice when the tilted chance is above 45¢. Above 72¢ is still refused.
- Three settled losses in a row block new orders for 20 minutes from the third settlement. One loss does not. A win resets the count.
- A score of 11, or a feature score of at least 0.75, adds a logit of 0.80. A score of 8, or a feature score of at least 0.45, adds 0.45.
- One contract can still have only one live order. A second series in the same 15 minutes is allowed. The old one-order-per-window rule is off.
- Spark and Alexandria use their own probability. That number moves the chance. If the fresh read disagrees with the ticket, the ticket sits. A missing file does not sit the book.
- Perpetual orders are unlocked on their own button. One contract still has to cost $3 or less. Meme coins are a third button on the same cash. They do not send until a pool check passes.
- The status file has `latency.lastMs`, `p50`, `p95`, `p99`, and `late`. A loop over 5 seconds does not send that tick.
- Half-Kelly cannot spend more than $3, the −$15 day stop, or the $9 open cap.

There is no daily cron. A 7/14/20/50 cross is not an entry by itself. Firecrawl, Spark, and Alexandria are in the chance through `intel-gate.ts`. They still do not send. Meme coins are not on this order path.

**Single authoritative trading strategy:** [docs/STRATEGY.md](docs/STRATEGY.md).
**Repair, test limitations, release criteria:** [docs/archive/AURIX_RELEASE_REPORT-2026-10-09.md](docs/archive/AURIX_RELEASE_REPORT-2026-10-09.md).
**Integration map:** [docs/archive/AURIX_COMPONENT_MAP-2026-10-09.md](docs/archive/AURIX_COMPONENT_MAP-2026-10-09.md).

## Live decision flow
`desk/feeds.ts` → `desk/engine.ts` → `desk/settlement.ts` →
`desk/features.ts` and `desk/sniper.ts` (research evidence) →
`desk/gate.ts` (executable YES/NO edge) → `desk/risk.ts` →
`desk/oms.ts` (only signed production order writer) → `desk/ledger.ts`.

MiroFish/Firecrawl and Spark/Alexandria data are read-only inputs through
`desk/intelligence.ts`. They are NOT calibrated trade-win probabilities.

Kalshi perpetual orders remain disabled independently; they are not 15-minute
binary ticket trades. A cockpit button is informational and cannot fire.

## Docs, in this order
The product spec outranks every older note. Read these, and only these, for what the desk is:

1. [docs/product/PRD.md](docs/product/PRD.md)
2. [docs/architecture/SYSTEM_MAP.md](docs/architecture/SYSTEM_MAP.md)
3. [docs/strategies/STRATEGY_REGISTRY.md](docs/strategies/STRATEGY_REGISTRY.md)
4. [docs/venues/VENUE_MATRIX.md](docs/venues/VENUE_MATRIX.md)
5. [docs/operations/RISK_MANDATES.md](docs/operations/RISK_MANDATES.md)
6. [docs/operations/RUNBOOK.md](docs/operations/RUNBOOK.md)

[docs/STRATEGY.md](docs/STRATEGY.md) is the Kalshi 15-minute rulebook. It does not replace the PRD. Anything in `docs/archive/` is historical. Do not follow it when it disagrees with the six files above. The approved 15-minute day stop is −$15, in the risk mandate, not whatever an archived handoff said.

## How we write code
`main` is the only product line. Start from the latest `origin/main`. Use a short-lived branch and a pull request into `main`. Do not open work against `desk-brain-mirofish` or keep writing on `fix/aurix-x`. One agent writes at a time. [PR #2](https://github.com/yougotsam/MacroMiro/pull/2) is already inside `main`. Do not merge it.

## Development
Node 22. After a change: `bun test`, `npm run typecheck`, `npm run lint`. Do not commit secrets or the files under `data/`.
