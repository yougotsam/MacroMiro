# Macro Miro

One trading desk. One canonical GitHub repository: **yougotsam/MacroMiro**, branch **main**. Use a short-lived pull request branch for each change. Vercel displays the website; the automated market-data/execution worker must be supervised separately.

## What is in this project?

- **15-minute Kalshi YES/NO research:** the exact contract and settlement model, market/strike selection, checklist, time windows, order and risk management in `src/lib/desk/` and `src/lib/signal/`.
- **Kalshi margin perpetuals research:** candidate scanner, liquidity/order-book gates, stop and target plans, research ranking, and margin-account/OMS groundwork in `src/lib/perps/`.
- **Fundamentals:** source- and timestamp-aware calendar, macro releases, Firecrawl, Spark, Alexandria and MiroFish research. Fresh narrative confidence **is not** independently calibrated trade probability.
- **Dashboard:** the TanStack application. The live trading worker is **not** proven to be running by a successful Vercel deployment.

## Current operational state (reviewed November 11, 2026, main 671fe1b)

- Vercel website: built from the current `main` branch.
- The perps HTTP order endpoint `/api/live/perp-fire` explicitly returns `locked: true`, `sendsOrders: false`.
- The 15-minute live approval flag `CALIBRATED_MODEL_APPROVED` remains **false**.
- Existing 15-minute simulation reports are based on next-bar/assumed-fill proxies, **not verified live execution or final Kalshi settlements**.
- Historical perps candle replay shows negative results for several studied assets. No strategy in this repository should be advertised as proven profitable or live-ready.
- Historical data, cache files and journals exist in `data/` and must be preserved before moving them out of Git. They are not application source files.

## Change the right rules

| Change | Place to work | Never confuse with |
|---|---|---|
| Entries, sniper setups, regime, candle and liquidity signals | `src/lib/signal/`, `src/lib/desk/sniper.ts`, `src/lib/perps/candidates.ts` | A certified hit probability |
| Prediction vs perps model and after-cost rank | `src/lib/desk/settlement.ts`, `src/lib/perps/sniper-evidence.ts`, `src/lib/perps/rank.ts` | AI narrative confidence |
| Account exposure, venue reconciliation, stop/target and emergency exits | `src/lib/desk/risk.ts`, `src/lib/perps/oms.ts`, `src/lib/perps/manage.ts` | An optional indicator vote |
| Developer instructions | `AGENTS.project.md`, `.grok/skills/macromiro-sniper/SKILL.md` | Executable strategy rules |
| Historic reports, order records, market caches | `data/` | Application code or junk |

## How to work on it

1. Identify the actual failure on `main` and create **one** review branch.
2. Repair the failure while keeping protection, risk and order-invariant tests.
3. Run `bun test`, `bun run typecheck` and the safe application build `node scripts/with-app-env.mjs vite build`.
4. Review the preview, merge one pull request to `main`, and use that single deployed version as the next starting point.
5. Evolve strategy rules **after** the execution architecture is consistent. Test research setups on historical market data without placing orders. Money is not needed for software tests or offline backtesting. Backtesting does not guarantee profit.

**Do not enable real orders by merely setting a flag.** The venue, account, risk, execution, fill protection and recovery paths must work together first. This repo is not at that state yet.

For the current repository footprint and what can safely be untracked, see `docs/operations/REPO_CLEANUP.md`.
