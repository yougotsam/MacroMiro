# AURIX-X project rules
Read `docs/STRATEGY.md` and `docs/archive/AURIX_RELEASE_REPORT-2026-10-09.md` first.
One canonical evidence-based Kalshi settlement-probability strategy;
technical indicators provide independently tested structure and timing
evidence, never heuristic percentage boosts. MiroFish, Firecrawl, Spark2
and Alexandria contribute timestamped context; their narrative confidence
is not a calibrated contract win probability.

All orders must use `src/lib/desk/oms.ts` → risk check. No direct alternate
API POST paths. No missing prices, synthetic settlement prints or silent
risk-latch overrides. Perpetual orders remain disabled pending a separate
production release. Live deployment stays blocked while
CALIBRATED_MODEL_APPROVED is false.

No fabricated tests, fill prices, profitability claims, or source certainty.
Unrelated NFC/transit features remain unless explicitly authorized for removal.

## Canonical docs (read first, 2026-10-12)
docs/product/PRD.md · docs/architecture/SYSTEM_MAP.md · docs/strategies/STRATEGY_REGISTRY.md · docs/venues/VENUE_MATRIX.md · docs/operations/RISK_MANDATES.md · docs/operations/RUNBOOK.md · docs/decisions/ADR-001-OPPORTUNITY-HUNTER.md. Anything in docs/archive/ is historical and must not guide execution.
