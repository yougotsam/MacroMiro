# MacroMiro — AURIX-X Kalshi Desk

**Current trading state: the 15-minute rule is loaded. It sends when `kalshi_live`, `kalshi_begin`, and `desk_arm` are all on.** `CALIBRATED_MODEL_APPROVED` is `true`. `APPROVAL_POLICY_ENFORCED` is `false`, so a missing calibrator file does not sit a ticket. `PERPS_ORDERS_LOCKED` is `false`. The 15-minute engine does not send a perp. `POST /api/live/perp-fire` can, one contract, at most $3, and only when the same three switches are on. Meme coins are not on the 15-minute order path. No pair is approved.

The numbers below are the ones in [src/lib/desk/config.ts](src/lib/desk/config.ts). If this page disagrees with that file, that file wins and this page is wrong.

Scored rules that are on, as of 21 Oct 2026:

- Buy from 36¢ to 95¢. Under 36¢ is refused. Over 95¢ is refused. The chance still has to beat the price and the fee. The 36¢ floor is a loss cut from 26 settled fills (3 wins, about −$29.50, both halves negative). It is not a claim that 36¢ and above is a proven edge.
- Three settled losses in a row block new orders for 20 minutes from the third settlement. One loss does not. A win resets the count.
- A score of 11, or a feature score of at least 0.75, adds a logit of 0.80. A score of 8, or a feature score of at least 0.45, adds 0.45. Anything smaller uses a step of 0.16 times the feature magnitude. The 0.80 step is not cut at 4 points.
- One contract can have only one live order. A second series in the same 15 minutes is allowed.
- A fresh Spark, Alexandria, or MiroFish read that disagrees with the ticket sits it. A missing or stale file does not. A major CPI, NFP, PPI, or FOMC print sits new tickets from 30 minutes before until 15 minutes after, when the calendar row has an explicit timezone.
- The status file has `latency.lastMs`, `p50`, `p95`, `p99`, and `late`. A loop over 5 seconds does not send that tick.
- Half-Kelly cannot spend more than $3, the −$15 day stop, or the $9 open cap. Same-direction crypto is capped at $4.

There is no daily cron. A 7/14/20/50 cross is not an entry. Firecrawl, Spark, and Alexandria move the chance through `intel-gate.ts`. They still do not send by themselves.

**Single authoritative trading strategy:** [docs/STRATEGY.md](docs/STRATEGY.md).
**Repair, test limitations, release criteria:** [docs/archive/AURIX_RELEASE_REPORT-2026-10-09.md](docs/archive/AURIX_RELEASE_REPORT-2026-10-09.md).
**Integration map:** [docs/archive/AURIX_COMPONENT_MAP-2026-10-09.md](docs/archive/AURIX_COMPONENT_MAP-2026-10-09.md).

## Live decision flow
`desk/feeds.ts` → `desk/engine.ts` → `desk/settlement.ts` →
`desk/features.ts` and `desk/sniper.ts` (research evidence) →
`desk/gate.ts` (executable YES/NO edge) → `desk/risk.ts` →
`desk/oms.ts` (only signed production order writer) → `desk/ledger.ts`.

MiroFish, Firecrawl, Spark, and Alexandria are read through `desk/intelligence.ts` and judged in `desk/intel-gate.ts`. A fresh disagreeing read can sit a ticket. None of them is the settlement probability.

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
