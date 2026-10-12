# AURIX-X Unified Handoff — 2026-10-09
Target branch: `desk-brain-mirofish` (source ZIP received); changes exist in an
offline working copy and have **not** been pushed to GitHub.

Read these three documents in this order:
1. [docs/STRATEGY.md](docs/STRATEGY.md): **one canonical strategy**.
2. [docs/AURIX_RELEASE_REPORT.md](docs/AURIX_RELEASE_REPORT.md): what was
   actually implemented/tested and unresolved production blockers.
3. [docs/AURIX_COMPONENT_MAP.md](docs/AURIX_COMPONENT_MAP.md): ownership and
   program call paths.

`src/lib/scan/edge.ts` does not exist in this ZIP; retired handoff references to it are invalid.
Prediction-market trading is currently blocked by
`CALIBRATED_MODEL_APPROVED = false`; this is deliberate until calibration
and live execution tests. All perps order posts are disabled.

Do not re-enable production to test. Test in isolated paper/demo or shadow
environments after installing dependencies, and gather real (not fabricated)
quotes, index, settlements and fills. Never commit credentials or real data
in version control. Do not remove unrelated NFC/transit functionality.
