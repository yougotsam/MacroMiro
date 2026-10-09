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
