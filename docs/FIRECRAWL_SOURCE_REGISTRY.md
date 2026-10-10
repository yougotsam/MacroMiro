# Firecrawl & News Source Registry (single source of truth)

Audited **Fri Oct 9, 2026, ~2:15 PM PT**. Code mirror: `src/lib/intel/sources.ts` (a test fails if a source is in the code but not in this doc).
Evidence file: `/workspace/data/research/firecrawl-audit.json`, re-run any time with `bun scripts/firecrawl-source-audit.ts` (free; add `--scrape` for one 1-credit test).

**Research only.** None of these sources can place, size, approve or block an order, or change a settlement probability. The only thing news can do to trading is the existing *official-calendar* blackout (verified release times from BLS/BEA/Fed). Web text is treated as untrusted data.

## Plain-English summary

- **Active and proven today: 16 sources** (11 free feeds + 5 Firecrawl uses). **Broken: 0** after fixes. **Duplicate: 1** (a second Firecrawl monitor watching the same BLS page). **Planned/not wired: 3.** **Unused: 2.**
- Most news actually comes in through **free** official RSS/calendar feeds, not Firecrawl. Firecrawl is used for: the Spark2 "daily brief", 4 research "clerks", 2 page monitors, MiroFish article seeding, and on-demand page reads.
- **The money:** your Firecrawl account is on the **Free plan (1,000 credits/month)** plus a large prepaid balance of **192,472 credits** left. October so far used **6,389 credits** in 9 days (~21,000/month pace). Nearly all of that is the Spark2 brief running every 90 minutes. You are **not being charged monthly right now**; usage draws down the prepaid balance.
- **Fix made:** Spark2 brief now runs every 6 h instead of every 90 min (fresh headlines still arrive hourly from the free feeds). New pace ≈ **11,400 credits/month ≈ $57/month at Firecrawl's pay-as-you-go rate**, versus ≈ **$107/month** before. Since it comes out of the prepaid balance, the out-of-pocket cost is **$0** until that runs out (~17 months at the new pace vs ~9 before).
- A **monthly credit ceiling** (default 12,000; set `FIRECRAWL_MONTHLY_CREDIT_CEILING`) now alerts at 50/80/100% and automatically pauses nonessential paid crawls (Spark2 brief, clerks) when hit. Free feeds and the CPI-release read keep running.

## Registry

Status key: VERIFIED = real retrieval succeeded today · BROKEN · PLANNED = referenced/proposed, not running · UNUSED = wired but feeds nothing · DUPLICATE.
Cost uses Firecrawl's pay-as-you-go reference of **$5 per 1,000 credits = $0.005/credit** (Hobby plan, firecrawl.dev/pricing, effective Sep 4, 2026). Actual cash cost today is $0 (prepaid balance).

| Website | Exact URL | Topic | Connection method | Status | Current frequency | Recommended frequency | Last verified success | Monthly credits (now → rec.) | Monthly cost (now → rec.) | Destination | Required fix |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BLS release calendar | https://www.bls.gov/schedule/news_release/bls.ics | CPI/NFP/PPI release times | Direct iCal | VERIFIED (313 events, next CPI Oct 14 5:30 AM PT) | every 6 h (calendar refresher) | every 6 h | Oct 9 2:14 PM PT | 0 | $0 | macro-calendar → trading blackout gate | None. Note: BLS returns 403 to bare curl; needs a browser user-agent (code already sends one) |
| BEA release calendar | https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics | GDP/PCE release times | Direct iCal | VERIFIED (166 events) | every 6 h | every 6 h | Oct 9 2:14 PM PT | 0 | $0 | macro-calendar | None |
| Federal Reserve FOMC calendar | https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm | FOMC dates | Direct HTML | VERIFIED (54 events) | every 6 h | every 6 h | Oct 9 2:14 PM PT | 0 | $0 | macro-calendar | None |
| Federal Reserve press RSS | https://www.federalreserve.gov/feeds/press_all.xml | Fed statements/speeches | RSS | VERIFIED (newest Oct 9 7:00 AM PT) | when the app's news panel loads | hourly | Oct 9 2:14 PM PT | 0 | $0 | news panel → Spark2 seed | Audit probe now reads CDATA dates |
| SEC press releases RSS | https://www.sec.gov/news/pressreleases.rss | Crypto/ETF regulation | RSS | VERIFIED (newest Oct 9 7:59 AM PT) | via Spark2 URL list only | every 2 h | Oct 9 2:14 PM PT | 0 | $0 | Spark2 seed | Was only read through paid Spark2 (sec.gov/newsroom page); free RSS is the better path |
| CFTC general press RSS | https://www.cftc.gov/RSS/RSSGP/rssgp.xml | Derivatives/crypto regulation | RSS | VERIFIED (newest Oct 9 1:00 PM PT) | not polled | every 6 h | Oct 9 2:14 PM PT | 0 | $0 | news panel | Free replacement for the paid CFTC page in the Spark2 list |
| CoinDesk RSS | https://www.coindesk.com/arc/outboundfeeds/rss | Crypto news | RSS | VERIFIED (newest Oct 9 1:20 PM PT) | when news panel loads | hourly | Oct 9 2:14 PM PT | 0 | $0 | news panel → MiroFish seed candidates | Old URL with trailing slash now 308-redirects; follow redirects |
| CNBC markets RSS | https://www.cnbc.com/id/100003114/device/rss/rss.html | Macro/market news | RSS | VERIFIED (newest Oct 9 1:52 PM PT) | when news panel loads | every 2 h | Oct 9 2:14 PM PT | 0 | $0 | news panel | None |
| Google News RSS (query) | https://news.google.com/rss/search?q=Federal+Reserve+OR+FOMC+OR+CPI+OR+bitcoin+OR+gold | Aggregated headlines | RSS | VERIFIED (100 items) | when news panel loads | every 2 h | Oct 9 2:14 PM PT | 0 | $0 | news panel | Aggregator: lowest trust, dedupe against originals |
| Forex Factory weekly XML | https://nfs.faireconomy.media/ff_calendar_thisweek.xml | Consensus forecasts | Direct API (XML) | VERIFIED (HTTP 200, 28 KB) | per news-kill check | every 6 h | Oct 9 2:14 PM PT | 0 | $0 | news-kill / skill news read | None (secondary to official calendars) |
| biquote calendar API | https://biquote.io/api/calendar | Consensus/actuals | Direct API (JSON) | VERIFIED (HTTP 200) | per news-kill check | every 6 h | Oct 9 2:14 PM PT | 0 | $0 | news-kill | Unofficial third party; keep as backup only |
| BLS CPI/NFP release text | https://www.bls.gov/news.release/cpi.nr0.htm | Actual CPI print at release | Firecrawl scrape | VERIFIED (BLS schedule page scraped via Firecrawl, 1 credit, HTTP 200) | on demand | event-aware: 30 min before → 90 min after each release, every 10 min | Oct 9 2:14 PM PT | 0 → ~96 | $0 → $0.48 | MiroFish seed → Alexandria post-event check | Scheduling added (`isDue` event mode) |
| Firecrawl monitor: BLS CPI + Fed FOMC schedule | https://www.bls.gov/schedule/news_release/cpi.htm + fomccalendars.htm | Schedule change detection | Firecrawl monitor | VERIFIED (id 01a0cd04-a028…, last run Oct 9 9:05 AM PT, 2 pages "same") | every 6 h | every 6 h | Oct 9 9:05 AM PT | 240 → 240 | $1.20 → $1.20 | Firecrawl dashboard only (no webhook) | Optional: add signed webhook once a secret is set |
| Firecrawl monitor: BLS CPI only (second copy) | https://www.bls.gov/schedule/news_release/cpi.htm | Same page as above | Firecrawl monitor | DUPLICATE (id 01a0cd04-b443…) | every 6 h | remove | Oct 9 9:05 AM PT | 120 → 0 | $0.60 → $0 | nowhere | **Delete in Firecrawl** — needs your OK (I did not delete anything) |
| Spark2 daily brief (14 official URLs) | https://api.firecrawl.dev/v2/agent | Next catalyst + official headlines | Firecrawl agent (Spark2) | VERIFIED (last completed Oct 9 12:39 PM PT, 76 credits) | every 90 min, 24/7 (heart worker keeps it awake) | every 6 h | Oct 9 12:39 PM PT | ~36,500 (≈19,000 actual pace) → 9,120 | ~$182 (≈$95 actual) → $46 | Spark card → research context | **Fixed:** 90 min → 6 h, paused at credit ceiling, credits logged |
| Intel clerks (verify/hunter/contradict/analogue) | https://api.firecrawl.dev/v2/agent | Spark2 research workflows | Firecrawl agent (Spark2) | VERIFIED (last run Oct 9 2:01 PM PT) | 4 jobs every 6 h | every 6 h | Oct 9 2:01 PM PT | ~1,800 → ~1,800 | ~$9 → $9 | shadow-intel.jsonl (apply:false, never trades) | **Fixed:** paused at credit ceiling, credits logged |
| Firecrawl news search (MiroFish seeding) | https://api.firecrawl.dev/v2/search | Catalyst articles | Firecrawl search + scrape | VERIFIED (test: 3 news hits, 2 credits) | per MiroFish seed | on demand (per catalyst) | Oct 9 2:12 PM PT | ~100 → ~100 | $0.50 → $0.50 | MiroFish seed | Search dates are relative ("6 hours ago"); now normalised to real timestamps |
| CME FedWatch | https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html | Rate-cut odds | Firecrawl scrape | PLANNED (scrape works but returns the page shell; odds load by script) | inside Spark2 list | on demand | Oct 9 2:12 PM PT | 0 | $0 | Spark2 URL list | Direct GET is 403. Would need a browser-action scrape; not worth it yet |
| CF Benchmarks BRTI page | https://www.cfbenchmarks.com/data/indices/BRTI | Index reference | Firecrawl scrape | UNUSED (scrape OK, 1 credit) | never | on demand | Oct 9 2:12 PM PT | 0 | $0 | reference only | Settlement uses Kalshi/Coinbase data, not this page |
| CFTC COT (CME financial) | https://www.cftc.gov/dea/futures/deacmesf.htm | Weekly gold positioning | Direct HTML | PLANNED (HTTP 200; only the Python pipeline references it, and that is not running) | never | daily (Fri) | Oct 9 2:14 PM PT | 0 | $0 | python watchlist (idle) | Wire only if a gold setup needs positioning |
| EIA weekly petroleum | https://www.eia.gov/petroleum/supply/weekly/ | Oil inventories | Firecrawl scrape (in `pullOfficial`) | UNUSED | when radar is POSTed | on demand | Oct 9 2:14 PM PT (direct 200) | 0 | $0 | none (oil not traded) | Drop from paid paths |
| Coinbase + Kraken status RSS | https://status.coinbase.com/history.rss | Exchange incidents/outages | RSS | PLANNED (both feeds 200 today) | never | hourly | Oct 9 2:14 PM PT | 0 | $0 | exchange_incident catalyst | Wire into MiroFish `exchange_incident` trigger |

Other sites referenced only in docs/prompts (no live code path): Reuters, Treasury press page, IMF news, Nasdaq news, FRED homepage, ECB calendars, Farside / The Block ETF pages, SPDR gold bar list, Kalshi docs. Treasury/IMF/Nasdaq/FRED/SEC/CFTC/CME pages are read only *inside* the Spark2 agent (its 14-URL list), not separately. Kalshi and Coinbase are market-data APIs (not news) and are covered by the collector audit, not here.

## Totals

- Active (VERIFIED): **16** · Broken: **0** · Duplicate: **1** · Planned: **3** · Unused: **2**.

## Actual Firecrawl usage and budget (from Firecrawl's own API, 0-credit endpoints)

| Item | Value |
|---|---|
| Plan | Free (1,000 plan credits/month) + prepaid balance |
| Remaining credits | 192,472 (Oct 9, 2:15 PM PT) |
| Billing period | Sep 22 → Oct 22, 2026 |
| Used Jul / Aug / Sep / Oct-to-date | 21 / 51 / 869 / 6,389 |
| Monitors | 2 active, both every 6 h; Firecrawl estimates 240 + 120 credits/month |
| This audit's test spend | ~6 credits (3 scrapes, 1 search, 1 scrape in the probe script) |
| LLM/Zep costs | not Firecrawl; reported separately by the MiroFish cost meter |

Recommended monthly total ≈ **11,400 credits ≈ $57/month reference** (Spark2 9,120 + clerks ~1,800 + monitor 240 + release reads ~96 + seeding ~100), down from a ~21,000/month pace. Cash cost $0 while the prepaid balance lasts.

## Code and schedule changes in this commit

1. `src/lib/intel/sources.ts` – source registry, `isDue` scheduler (event-aware / fixed cadence / on-demand), content-hash + canonical-URL dedup, freshness limits, publication-date normalisation, provenance record (URL, published, retrieved, hash, method, trust label), article → catalyst mapping so duplicate articles share one MiroFish job, credit ceiling + alerts + nonessential suspension.
2. `src/lib/intel/budget.server.ts` – local credit ledger (`/workspace/data/firecrawl-credits.jsonl`), idempotent per Firecrawl job id.
3. `src/lib/live/spark.server.ts` – Spark2 brief every 6 h (was 90 min); skipped when the ceiling is hit; credits logged; card valid 7 h.
4. `src/lib/intel/run.server.ts` – clerks skipped when the ceiling is hit; credits logged once per job.
5. `src/routes/api/firecrawl/webhook.ts` + `src/lib/intel/webhook-auth.ts` – webhook now **fails closed**: with no `FIRECRAWL_WEBHOOK_SECRET` every call is refused; a real HMAC-SHA256 signature or bearer secret is required (before: any non-empty signature header was accepted, and no secret meant fully open on port 8080). Payload capped at 512 KB.
6. `scripts/firecrawl-source-audit.ts` – repeatable evidence probe.
7. `src/lib/intel/sources.test.ts` – 17 tests: schedule, budget, dedup, timestamps, one-MiroFish-job-per-catalyst, webhook auth, and no crawl module importing order/risk/gate/probability code.

## Removed duplicates

- Second Firecrawl monitor on the BLS CPI page (`01a0cd04-b443-710f-b0cf-8f1c6a55b0da`) – flagged DUPLICATE and never scheduled by our code; **deleting it in Firecrawl needs your approval**.
- SEC/CFTC/Fed press pages read through paid Spark2 are duplicated by free official RSS; recommended to trim them from the Spark2 URL list (not changed yet, to avoid altering the Spark2 prompt mid-run).

## Recommendations, ranked by trading usefulness

1. **Official calendars (BLS/BEA/Fed)** – keep every 6 h; they drive the only news rule that touches trading (blackout). Free.
2. **Event-aware BLS release read** around CPI/NFP/PPI – gives the actual print within minutes for post-event checks. ~$0.50/month.
3. **Exchange status feeds (Coinbase/Kraken)** – wire next: outages directly affect crypto index settlement. Free.
4. **Fed + SEC RSS hourly** – real catalysts for crypto/ETF and rates. Free.
5. **CoinDesk/CNBC/Google News** – context and MiroFish seeding, every 1–2 h, deduped. Free.
6. **Spark2 brief at 6 h** – useful summary, but it is the main cost; consider 12 h if the brief is rarely read.
7. **Clerks at 6 h** – no measured value yet (all `apply:false`); first candidates to pause if credits matter.
8. CME FedWatch, CF Benchmarks page, CFTC COT, EIA – leave off until a setup needs them.

## Still unverified

- Whether the Spark2 brief or clerks add any predictive value (nothing measured yet).
- Real dollar billing for the prepaid balance (whether it was bought or granted) – visible only in the Firecrawl dashboard.
- Firecrawl's exact webhook signature format was implemented per its docs (`X-Firecrawl-Signature: sha256=<hmac>`); no live webhook is configured, so it is not exercised end to end.
- RSS feeds are fetched by the app's news panel on page load, not by a standing scheduler; the `isDue` schedule is implemented and tested but a dedicated poller is not yet running (to avoid adding another background process mid-collection).

---

# Round 3.3 Intel Grid update (Oct 9, 2026, 2:20–3:00 PM PT)

## Account and capability check (read-only; billing not changed)

| Item | Finding (Firecrawl API, 0-credit endpoints) |
|---|---|
| Plan | **Free** (1,000 plan credits/month; `maxConcurrency` 2) |
| Prepaid balance | **192,400 credits** left at ~2:55 PM PT |
| Renewal | 1,000 plan credits refresh each period; current period Sep 22 → **Oct 22, 2026** (2:09 PM PT) |
| Expiration | Firecrawl's pricing page: bought credits "stay on your account until you use them" and "expire if you cancel your subscription". On the Free plan there is no paid subscription; confirm in the dashboard whether this balance is purchased or granted. |
| Auto-recharge / pay-as-you-go | Pricing page: pay-as-you-go is **"paid plans only"**. On Free it cannot add charges. **Cash-charge risk: none from API use while on Free.** Risk appears only if the plan is upgraded with a card and no monthly pay-as-you-go limit is set ("enter nothing for no limit"). Not visible via API; check Billing settings. |
| Rate limits seen | `/scrape`/`/search`/`/map` ~10/min; `/monitor` create/run ~3–4 per minute (429s observed); `/agent` 2/min (Free) |
| Usage by endpoint (last 24 h, `/team/activity`, 100 most recent jobs) | scrape 25, agent 29, alexandria 24, search 20, map 2 |
| Usage by key (`/team/credit-usage/historical?byApiKey`) | "Default" key carries almost all use; "Connected app" 32 credits in Sep |
| Docs read | llms-full.txt sections: agent (exchange, requireApproval, onTermsRequired), alexandria, monitoring (page/website/web-scale, judging, estimates), parse, webhooks (HMAC `X-Firecrawl-Signature: sha256=`), rate limits, activity, queue status |

**Integrations:** REST via our own clients (`src/lib/grid/fc.server.ts`, `src/lib/live/firecrawl.server.ts`) = VERIFIED_WORKING. Python SDK used by `pipeline/` = PRESENT_BUT_UNTESTED (package not installed; pipeline idle). Node SDK / CLI = UNAVAILABLE (not installed; not needed). Firecrawl MCP = UNAVAILABLE on this box. Webhooks = PRESENT_BUT_UNTESTED (verifier built and tested; box is not publicly reachable, so monitors are polled instead). Parse `/v2/parse` (PDF upload) = PRESENT_BUT_UNTESTED; HTML documents go through scrape markdown into our diff engine (VERIFIED_WORKING, see below).

## Monitors (all research-only)

Firecrawl gives an `estimatedCreditsPerMonth` (an upper bound when judging is on) at creation; recorded below. Per Sameer's course correction the 15k/month figure is a ceiling, not a target. **Only a short pilot is running.**

| Monitor | Firecrawl id | Exact targets | Schedule | Firecrawl estimate / month | State | Why this frequency |
|---|---|---|---|---|---|---|
| Official release pages | 01a1228e-deca-71d8-89e2-3c618bce65fc | bls.gov cpi.nr0, empsit.nr0, ppi.nr0; bea.gov current-releases | every 3 h (ET :15) | 1,920 (was 5,760 hourly; reduced) | **PILOT active** until 7:37 PM PT | Pages change only on release days; release minutes are covered by the free event-aware read. 3 h catches unscheduled corrections. Likely to drop to "release days only" after the pilot. |
| Web search: crypto exchange outages / ETF decisions | 01a12299-9384-72f8-a721-fd97238e08d1 | 2 queries, 6 h window, ≤10 results, judged | every 2 h | 5,040 | **PILOT active** until 7:37 PM PT | Unscheduled, market-moving for all 4 crypto markets; no official calendar exists. |
| Fed press-release section crawl | 01a1228e-fa50-73df-8186-c8c2cc04a507 | federalreserve.gov/newsevents/pressreleases (≤10 pages) | every 6 h | 2,400 (was 4,800 at 3 h) | **PAUSED** | Free Fed RSS (hourly) already catches new releases. |
| Web search: central-bank surprises / revisions / gold policy | – | – | every 4 h (proposed) | not created | **NOT CREATED** | Wait for pilot results. |
| (pre-existing) Envelope official calendars ×2 | 01a0cd04-a028… / 01a0cd04-b443… | BLS CPI schedule (+ Fed FOMC page) | every 6 h | 240 + 120 | active (untouched; b443 is the duplicate awaiting Sameer) | – |

No 5-minute monitor was created: none could be justified, because release-minute coverage comes from the event-aware read for ~96 credits/month.

### Measured pilot (running now)

- **Window:** Fri Oct 9, 2:37 PM → **7:37 PM PT**. Checks expected: search monitor at 3, 5 and 7 PM PT; release pages at 3:15 and 6:15 PM PT.
- **Auto-stop:** `scripts/grid/pilot-end.ts` runs at 7:37 PM PT (background `sleep`, pid in `/workspace/data/research/grid-pilot-end.pid`). It **pauses both pilot monitors** and writes the summary. Nothing recurring continues without Sameer's approval.
- **Read results (one command, 0 credits):** `bun scripts/grid/pilot-summary.ts` (any time; output also saved in `/workspace/data/research/grid-pilot-summary.json`). For each monitor it shows checks run, **actual** credits, projected monthly cost from actual use, pages changed/new, judged meaningful vs not (false-alert proxy), median detection delay vs publication time, and useful findings.

## Grid source table

Columns: Source | Exact endpoint | Topic | Retrieval method | Verified state | Actual frequency | Recommended frequency | Last successful retrieval | Credits consumed (per check → est./month at recommended) | Data destination | Licensing status

| Source | Exact endpoint | Topic | Retrieval method | Verified state | Actual frequency | Recommended frequency (why) | Last successful retrieval | Credits | Data destination | Licensing |
|---|---|---|---|---|---|---|---|---|---|---|
| BLS/BEA/Fed official calendars | bls.ics, bea .ics, fomccalendars.htm | release times | direct iCal/HTML | VERIFIED_WORKING | 6 h | 6 h (rarely changes) | Oct 9 11:35 AM PT | 0 → 0 | trading blackout gate | US gov public domain |
| BLS release text | bls.gov/news.release/cpi.nr0.htm etc. | actual prints | Firecrawl scrape (event-aware) + pilot monitor | VERIFIED_WORKING | pilot 3 h | release windows only (−30/+90 min, every 10 min) | Oct 9 2:12 PM PT | 1/page → ~96 | evidence → Spark → Alexandria check | public domain |
| Fed FOMC statements | federalreserve.gov/newsevents/pressreleases/monetaryYYYYMMDDa.htm | statement language | Alexandria fed press_releases → scrape → diff | VERIFIED_WORKING | E2E only | on FOMC days + 1 day | Oct 9 2:45 PM PT | 5 + 2×1 per FOMC → ~20 | statement-diff evidence | public domain |
| BLS CPI data | Alexandria bls-gov/economic-statistics/bls_cpi | CPI levels/revisions | Alexandria | VERIFIED_WORKING | E2E only | once per release (+ prior-month revision check) | Oct 9 2:38 PM PT | 5 → ~40 | MACRO_SURPRISE / RELEASE_REVISION | public domain via provider |
| Consensus | Alexandria forexfactory-com/economic-calendar | consensus forecasts | Alexandria | AVAILABLE (not executed) | – | before each major release | – | 5 → ~40 | MACRO_SURPRISE | third-party; attribution kept |
| FedWatch | Alexandria cmegroup-com/fomc-rate-probabilities | rate odds | Alexandria | AVAILABLE (not executed) | – | daily in FOMC weeks | – | 5 → ~60 | context only | CME data via provider |
| Treasury auctions | Alexandria treasury-fiscal-data/auctions/* | auctions/yields | Alexandria | AVAILABLE (not executed) | – | auction days | – | 1 → ~20 | context | public domain |
| CFTC COT | Alexandria cftc/* | gold positioning | Alexandria | AVAILABLE (not executed) | – | weekly (Fri) | – | 1 → ~5 | gold setup context | public domain |
| Crypto exchange incidents / ETF decisions | Firecrawl web-scale search monitor | outages, halts, ETF rulings | Firecrawl monitor (search) | PILOT | 2 h | decide after pilot (likely 4–6 h + event triggers) | pending first check 3 PM PT | ≤~7/check → 5,040 est. at 2 h | evidence → Spark | links + snippets; source sites' terms |
| Coinbase/Kraken status | status.coinbase.com/history.rss, status.kraken.com/history.rss | exchange incidents | RSS | VERIFIED (200 today) | not wired | hourly (free) | Oct 9 2:14 PM PT | 0 | exchange_incident trigger | public feeds |
| SEC / CFTC press | sec.gov/news/pressreleases.rss, cftc.gov/RSS/RSSGP/rssgp.xml | crypto regulation | RSS | VERIFIED | panel load | 2 h / 6 h (free) | Oct 9 2:14 PM PT | 0 | news panel | public domain |
| Kalshi rules/announcements, CF Benchmarks | kalshi.com rules pages; cfbenchmarks.com | contract terms, index methodology | Firecrawl scrape on demand | PLANNED | – | on demand when rules change | – | 1/page | reference | site terms |
| Gold: World Gold Council, COMEX notices | gold.org; cmegroup.com notices | gold demand/policy | Firecrawl search on demand | PLANNED | – | weekly / on demand | – | ~2/search | context | site terms |

Crawling is never used as a substitute for Kalshi quotes or the settlement reference; those stay on the Kalshi/Coinbase market-data feeds.

## Real end-to-end proof (job ids)

1. **Official source:** Alexandria `federalreserve-gov/central-bank-communications/press_releases`, 5 credits → FOMC statements Jul 29 and Sep 16, 2026.
2. **Parse/diff:** both statements scraped (1 credit each) → diff engine found 14 sentence changes (58%), e.g. "maintain the target range at 3-1/2 to 3-3/4" → "raise … by 1/4 point to 3-3/4 to 4 percent", vote 9–3 → 12–0. Evidence `ev-99997a9487b3da6d57b9`. (The first E2E pass wrongly diffed a minutes release against a statement; the selector now takes only "FOMC statement" items. That run is kept as `diffMinutesVsStatement` and not used.)
3. **Alexandria data:** `bls-gov/economic-statistics/bls_cpi`, 5 credits → CPI-U SA Jan–Aug 2026 (Aug 334.131).
4. **Spark 2:** job `01a1229a-e6ab-75c7-ad05-cb5709dd6f70`, completed, 32 credits, schema valid. It correctly reports Sep CPI is not yet published, consensus null (not invented), prior with source URL.
5. **Exchange approval:** job `01a1229b-c853-7788-9952-43de7ff929ed` stopped with pendingApproval `01a1229b-e520-76fe-9be2-9739f989808c` before a paid bls-gov call. Not approved.
6. **MiroFish:** reused archived run `rj-mv0y26fq-156cd2` (graph `mirofish_21950b20b1724e7e`, simulation `sim_8213826f62a5`, report `report_8ee84b659189`). No new simulation.
7. **Dashboard:** `/intel-grid` page reads `/workspace/data/research/grid-dashboard.json` (built by `bun scripts/grid/dashboard.ts`).

Full record: `/workspace/data/research/grid-e2e.json`; every call with credits: `/workspace/data/research/grid-calls.jsonl`.

## Credits spent this round

**72 credits** logged (Alexandria 10, scrape 6, Spark 2 agent runs 56; discovery, terms checks, maps and monitor setup 0). The account balance went from 192,470 to 192,400 over the run. Monitor checks during the pilot add a few credits per check, and the pilot summary reports them. The 5,000-credit build cap was not approached.

## Recommended monthly allocation for the whole grid (PROPOSAL, nothing recurring until Sameer approves)

| Bucket | Credits / month | What it buys |
|---|---|---|
| Spark 2 investigations | 6,000 | event-triggered medium/high runs for ~8–10 major releases plus a once-daily low-tier brief (replaces the 6-hourly brief, ~9,120) |
| Alexandria datasets | 1,500 | ~300 calls: BLS/FRED actuals and revisions, Forex Factory consensus, FedWatch, Treasury auctions, CFTC COT around events |
| High-value discovery (web-scale search monitors + targeted search) | 2,500 | the exchange-incident/ETF search monitor at the pilot-tuned interval, plus on-demand searches |
| Page monitors | 600 | release pages on release days only (event-driven), not around the clock |
| Parse/diff | 300 | FOMC statements, minutes, PDF releases |
| MiroFish-related Firecrawl (seeding) | 300 | source search and scrape for scenario seeds (LLM costs are separate) |
| Research clerks | 600 | down from ~1,800; first to cut if they show no value |
| Reserve | 700 | spikes (FOMC weeks, incidents) |
| **Total** | **≈ 12,500** | ≈ $62/month at the $0.005 pay-as-you-go reference; **$0 cash** from the prepaid balance |

Against 192,400 prepaid + 1,000/month free, that is roughly **16–17 months** of runway. The ceiling `FIRECRAWL_MONTHLY_CREDIT_CEILING` stays at 12,000 for now (auto-suspension unchanged). Raise it only with the allocation.
