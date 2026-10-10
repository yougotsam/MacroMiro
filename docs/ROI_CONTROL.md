# Intelligence ROI and control (Round 3.3 priority correction, Oct 9 2026)

Core question: what changes in the bot's decision because Firecrawl ran? Today: **nothing measurable**. Research features have weight 0 and none was available before any evaluated Kalshi window.

## Operating modes (server-side, persisted in `<DATA_ROOT>/operating-mode.json`)

| Mode | Firecrawl spend | Runs |
|---|---|---|
| FULL_STANDBY (default; also the fallback for a missing or bad file) | none | Kalshi collector, free calendar refresher, MiroFish backend (no new sims) |
| MARKET_DATA_ONLY | none | same |
| RESEARCH_PAPER | only `approvedJobs` | approved research; orders stay locked |
| LIVE_TRADING | not available here (reads as FULL_STANDBY) | – |

Switch: `bun scripts/ops/mode.ts set FULL_STANDBY` (pauses every remote monitor and re-reads each one from Firecrawl with retry), `bun scripts/ops/mode.ts set RESEARCH_PAPER --approve legacy_spark_brief,grid_calls`, `bun scripts/ops/mode.ts status`. Approvable jobs: legacy_spark_brief, intel_clerks, radar_official_scrape, news_search, article_scrape, grid_calls, grid_monitors, calendar_monitors, mirofish_seeding. The gate is in `src/lib/ops/operating-mode.ts`. It's checked inside every Firecrawl POST helper (`firecrawl.server.ts`), the legacy brief (`spark.server.ts`), the clerks (`run.server.ts`) and the grid client (`fc.server.ts`). The /intel-grid page shows the mode.

The dev server's 30-minute clock now calls the latest module's tick. Before this change, a hot reload left the original 90-minute closure running, so the "6 h" brief change never took effect. The job records show the brief at ~95-minute spacing all day. The dev server was restarted at 5:48 PM PT to drop the old closure.

## Rounds

`roundSpent()` used to sum the lifetime log. It now sums only calls tagged with the open round id. Use `bun scripts/ops/round.ts open <id> <budget> "<reason>"`, `status` and `close`. `reconcileRound()` compares the logged spend with Firecrawl's balance drop. That drop is authoritative and includes every spender on the account. Paid grid calls are refused in FULL_STANDBY unless a capped round is open.

## Per-job usage (measured Oct 9 2026; authoritative October usage 6,626 credits by 5:55 PM PT)

| Job | Trigger | State now | Observed frequency | Avg credits | Est./month as it was running | Consumed by |
|---|---|---|---|---|---|---|
| Legacy Spark 2 brief (`spark.server.ts`, 14 sources) | 30-min clock + radar GET | **paused (FULL_STANDBY)** | ~every 95 min (old closure) | 67.5 (8 paid runs Oct 9) | ~20,000–30,000 | envelope dashboard card only. Not read by the shadow evaluation |
| Intel clerks (verify/contradict/analogue/hunter) | armClerks on the same clock | **paused** | 2 batches Oct 9 | 10–45 per clerk (avg ~21) | ~2,000–4,000 | desk panel + shadow-intel.jsonl. `apply:false`, never used by a decision |
| Grid monitor: official release pages | Firecrawl cron 3 h | **paused, verified remote** | 1 check | 4 | ~960 | nothing (4 "new" = first baseline) |
| Grid monitor: web search (exchange outages/ETF) | Firecrawl cron 2 h | **paused, verified remote** | 2 checks | 10 | ~3,600 | nothing. 7 hits judged meaningful by Firecrawl, 0 relevant to a 15-min settlement |
| Grid monitor: Fed press section | cron 6 h | paused (never ran) | 0 | – | – | – |
| Envelope official calendars 01a0cd04-a028 | cron 6 h | **paused, verified remote** | 4/day | ~2 | ~240 | calendar fallback. The free refresher covers it |
| Envelope official calendars 01a0cd04-b443 (duplicate) | cron 6 h | **paused, verified remote** (not deleted) | 4/day | ~1 | ~120 | duplicate of the above |
| Grid Spark 2 / Alexandria (E2E) | manual | idle | once | 72 total | 0 | evidence store. Weight 0 |
| MiroFish source gathering | MiroFish pipeline | direct GET first; Firecrawl only as fallback, now gated | rare | ≤1 | ~0 | MiroFish seeds (research only) |
| Radar official scrape (`pullOfficial`) | /api/firecrawl/pull, catalyst refresh | gated | on demand | 1–3 | small | calendar card |

## Prompts

- `src/lib/live/spark.server.ts` (legacy brief): a 14-source generic macro brief. Its `probability` field is source-quoted odds such as FedWatch. The card now says so explicitly: "Not a Kalshi settlement probability".
- `src/lib/grid/spark-templates.ts` v1: CPI/catalyst investigator (E2E).
- `catalyst-investigator/v2` (new): the mission is verbatim. The schema has event_id, source URLs, published/detected/verified times, assets, catalyst type, factual surprise (actual/consensus/prior/revised), scenarios and conditions, 15-minute horizon relevance, novelty, uncertainty, feature availability and provider credit usage. `validateReportV2(report, decisionTime)` rejects any info published or available after the decision (replay leak), any probability field, trade advice and unsupported assets. No schedule is attached. It is meant to replace the legacy brief, run per scheduled release, only if approved.

## Trace and ROI

`bun scripts/grid/trace.ts` → `research/grid-trace.json`. `bun scripts/grid/roi.ts` → `research/grid-roi.json` (A/B/C plus budget tiers). Both cost 0 credits.
