# Alexandria Provider Registry (Firecrawl data-provider exchange)

Checked **Fri Oct 9, 2026, 2:20–2:40 PM PT**. Discovery and terms checks are free (0 credits). **No terms were accepted.** Paid calls need an approval record and are capped at 3 per round, each ≤ 50 credits (`src/lib/grid/alexandria.ts`).
Raw evidence: `/workspace/data/research/alexandria-discovery.json`, `alexandria-terms.json`, `alexandria-contracts.json`, `alexandria-providers.json`.

Status key: AVAILABLE · TERMS_REQUIRED · NOT_ENTITLED · UNSUITABLE · BROKEN. Alexandria is **not** our local evidence store (that is `/workspace/data/research/evidence.jsonl`).

| Provider | Capability (examples) | Access status | Terms status | Required fields | Price/credits | Data coverage | Freshness | Tested result | Research purpose |
|---|---|---|---|---|---|---|---|---|---|
| bls-gov | economic-statistics/bls_cpi, bls_series, bls_unemployment_rate | AVAILABLE | not required | `category` (e.g. all_items, core), optional area_code, years, seasonally_adjusted | 5 / call | CPI by category, any BLS series | as published by BLS (Aug 2026 latest on Oct 9) | **Paid call #2: OK, 5 credits** – CPI-U all items SA, Jan–Aug 2026, latest 334.131 (Aug) | Actual/prior/revised CPI for MACRO_SURPRISE and RELEASE_REVISION |
| federalreserve-gov | central-bank-communications/press_releases, press_release, fomc_meetings, speeches, calendar | AVAILABLE | not required | optional from/to/type/query | 5 / call | Board press releases, FOMC dates, speeches | same day | **Paid call #1: OK, 5 credits** – 5 monetary-policy releases incl. FOMC statements Jul 29 and Sep 16 | FOMC statement diff, Fed calendar |
| cmegroup-com | fomc-rate-probabilities/fedwatch_meetings, fedwatch_probability_history, futures_quotes | AVAILABLE | not required | product/meeting per contract | 5 / call | FedWatch probabilities, futures | intraday (per provider) | not executed (cap) | Replaces the FedWatch page we can't scrape (it loads by script) |
| treasury-fiscal-data | auctions/upcoming, auctions/results, debt/average-interest-rates | AVAILABLE | not required | optional filter/sort/fields | **1** / call | Treasury auctions, cash, debt | daily | contract read only | Auction calendar and results (yields context) |
| fred-stlouisfed-org | economic-data/series_observations, series_search, releases | AVAILABLE | not required | series_id | 5 / call | All FRED series | per series | contract read only | Revision history, long baselines |
| forexfactory-com | economic-calendar/list_events, event_detail, event_history | AVAILABLE | not required | event_id / dates | 5 / call | Calendar with consensus | live | contract read only | **Consensus** values (needed for MACRO_SURPRISE); third-party, so labelled as such |
| cftc | financial/futures-only, disaggregated/combined, legacy/* | AVAILABLE | not required | market | **1** / call | Commitments of Traders | weekly (Fri) | contract read only | Gold positioning (planned) |
| cftc-gov | commitments-of-traders/disaggregated_combined | AVAILABLE (terms not checked) | not checked | market | 5 / call | same as above | weekly | – | Duplicate of `cftc`; prefer the 1-credit `cftc` |
| data-worldbank-org, ec-europa-eu, servicodados-ibge-gov-br, bcb-gov-br | indicators | UNSUITABLE | – | – | 5 / call | non-US macro | – | – | Not our markets |
| join-com, ziprecruiter-com, greenhouse-io | jobs listings | UNSUITABLE | – | – | – | job ads | – | – | Irrelevant search hits |

**Agent + exchange approval (real run):** Spark 2 job `01a1229b-c853-7788-9952-43de7ff929ed` with `exchange.requireApproval: true`, `mode: "chat"`, toolkits `[bls-gov]` stopped with pendingApproval `01a1229b-e520-76fe-9be2-9739f989808c` before calling `bls-gov/economic-statistics/bls_series` (estimate 5 credits). **We did not approve it.** Agent reasoning cost 24 credits; provider calls 0.

**Needs Sameer:** nothing for terms (none of the relevant providers require terms). Ongoing paid use (e.g. ~300 calls/month ≈ 1,500 credits) needs approval as part of the allocation proposal.

Bias/leakage notes: BLS/FRED values can be revised; store the retrieval time and use only values available before each event (no look-ahead). Forex Factory consensus is a third-party aggregate.
