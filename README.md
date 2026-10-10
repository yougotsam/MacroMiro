# MacroMiro — AURIX-X Kalshi Desk

**Current trading state: RESEARCH / SHADOW ONLY.** A model-approval constant in
`src/lib/desk/config.ts` is `false`, so the production OMS refuses all live submissions.

**Single authoritative trading strategy:** [docs/STRATEGY.md](docs/STRATEGY.md).
**Repair, test limitations, release criteria:** [docs/AURIX_RELEASE_REPORT.md](docs/AURIX_RELEASE_REPORT.md).
**Integration map:** [docs/AURIX_COMPONENT_MAP.md](docs/AURIX_COMPONENT_MAP.md).

## Live decision flow
`desk/feeds.ts` → `desk/engine.ts` → `desk/settlement.ts` →
`desk/features.ts` and `desk/sniper.ts` (research evidence) →
`desk/gate.ts` (executable YES/NO edge) → `desk/risk.ts` →
`desk/oms.ts` (only signed production order writer) → `desk/ledger.ts`.

MiroFish/Firecrawl and Spark/Alexandria data are read-only inputs through
`desk/intelligence.ts`. They are NOT calibrated trade-win probabilities.

Kalshi perpetual orders remain disabled independently; they are not 15-minute
binary ticket trades. A cockpit button is informational and cannot fire.

## Development
Node 22 project; `bun test`, `npm run typecheck`, and `npm run lint` after
dependencies are installed. This delivered ZIP was NOT pushed to GitHub and
no production credential/API execution was performed.

All prior strategy/handoff versions are marked **retired** in `docs/archive/`.
Do not use their old $15 day-stop, direct chart-price trigger or unrestricted
order-writing instructions.
