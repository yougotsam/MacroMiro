# ADR-001: Expand from Kalshi-15m-only to a multi-venue Opportunity Hunter
Date: 2026-10-12 · Status: accepted by owner (PRD v0.1) · Supersedes the "one strategy" framing in docs/STRATEGY.md §1.

**Context.** Paper results (Oct 11): every Kalshi 15m config is negative after fees, and the edge is unproven. Phase 1 (Oct 12) showed that Kalshi perps are enabled on the account, with maker fees of 0.02% (crypto) and 0.0012% (metals). Coinbase spot at the Intro tier (0.50%/0.90%) cannot cover its costs on scalps.

**Decision.** Keep the Kalshi 15m engine as one strategy. Add a `PERPS_SCALPER` strategy on Kalshi perps (crypto + metals + index) using the existing sniper/indicator code and new perps-specific exit/fill/funding modelling. Add a read-only Kalshi pair-cost scanner. Use a shared selector and per-venue risk mandates.

**Consequences.** We need a persistent worker (the box pauses). Perps leverage needs its own mandate. The binary probability model stays out of perps.
