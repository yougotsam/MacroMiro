# MacroMiro — AURIX-X Kalshi Desk

**Current trading state: the 15-minute rule is loaded. It does not send unless `kalshi_live`, `kalshi_begin`, and `desk_arm` are all on.** `CALIBRATED_MODEL_APPROVED` is `true`. The arm file is off until you turn it on. Perpetual orders stay off. Meme coins are not on this order path.

Scored on the 29 whole fills through 21 Oct 2026, and left in force:

- Buy only from 36¢ to 72¢. The 18¢–38¢ flip band is the band that lost about $7.63. It is refused.
- A settled loss blocks new orders for 20 minutes from the settlement.
- One live order per 15-minute window.
- The chart moves the chance in log-odds, then the move is cut at 4 points. A +0.45 or +0.80 logit is not applied.
- Half-Kelly is in `sizing.ts`. It cannot spend more than $3, the −$15 day stop, or the $9 open cap. 15% of equity is a ceiling inside that function. On this account the $3 cap is the one that binds.

There is no daily cron. A 7/14/20/50 cross is not an entry. Firecrawl, Spark, and Alexandria are notes. They do not set the chance and they do not send.

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
