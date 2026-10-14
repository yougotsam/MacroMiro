# MacroMiro — AURIX-X Kalshi Desk

**Current trading state: RESEARCH / SHADOW ONLY.** A model-approval constant in
`src/lib/desk/config.ts` is `false`, so the production OMS refuses all live submissions.

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
