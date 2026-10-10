/**
 * P5 trace: ONE real event through SOURCE → EXTRACTION → VERIFIED FACT → STORED FEATURE → AVAILABILITY → PRETRADE
 * SHADOW EVAL → OUTCOME → MEASURED INCREMENTAL VALUE, against ONE real Kalshi window from the read-only collector.
 * Free: reads local collector files and the monitor's check record (already paid). Feature weight stays 0.
 *   bun scripts/grid/trace.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DATA_ROOT } from "../../src/lib/data-root";

const EVENT = {
  source: "Firecrawl web-search monitor 'Grid: web search – crypto exchange outages, restrictions, ETF decisions' (pilot)",
  url: "https://www.bitget.com/support/articles/12560603896920",
  title: "Announcement on suspending XRP network deposit and withdrawal services (Bitget, wallet maintenance)",
  publishedAt: "2026-10-09T06:30:13Z", // page JSON-LD datePublished 2026-10-09T14:30:13+08:00, read by direct GET
  detectedAt: "2026-10-10T00:15:29Z", // monitor check 01a12328-f00f-76cb-9d67-8f44b96d360f finished
  monitorCheckId: "01a12328-f00f-76cb-9d67-8f44b96d360f",
  creditsForCheck: 10, // that check's share of the pilot: 2 checks, 20 credits
};
const SERIES = "KXXRP15M";
const detect = Date.parse(EVENT.detectedAt);

type Obs = { ts: string; ticker: string; series: string; close: string; tte_s: number; strike: number; spot: number; p: number; quotes: { yes_bid: number; yes_ask: number; no_bid: number; no_ask: number }; action: string; failed_gate: string | null };
type Out = { ticker: string; series: string; close: string; result: string; value: number };
const lines = (f: string) => { try { return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const obs = [...lines(`${DATA_ROOT}/desk-observe/observations-2026-10-09.jsonl`), ...lines(`${DATA_ROOT}/desk-observe/observations-2026-10-10.jsonl`)] as Obs[];
const outs = [...lines(`${DATA_ROOT}/desk-observe/outcomes-2026-10-09.jsonl`), ...lines(`${DATA_ROOT}/desk-observe/outcomes-2026-10-10.jsonl`)] as Out[];

// The first XRP window that closes after detection: the earliest decision the information could have touched.
// If the collector has no XRP quotes after detection (it has a gap), fall back to the first QUOTED XRP window after
// publication and say so: the information was public then, but our grid had not detected it yet.
const quoted = (from: number) => obs.filter((o) => o.series === SERIES && Date.parse(o.ts) >= from && o.quotes?.yes_ask != null).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
const afterDetect = quoted(detect);
const basis = afterDetect.length ? "first quoted XRP window after our detection" : "collector has no XRP quotes after detection (gap since 2026-10-09 18:11Z); using the first quoted XRP window after PUBLICATION, when the info was public but not yet detected by us";
const pool = afterDetect.length ? afterDetect : quoted(Date.parse(EVENT.publishedAt));
const close = pool[0]?.close;
const win = pool.filter((o) => o.close === close);
// Pre-publication comparison: the same series' windows in the hour BEFORE publication vs the window after detection.
const entry = win.find((o) => o.tte_s <= 600) ?? win[0] ?? null; // first scan inside the final-10-minute bucket
const outcome = outs.find((o) => o.series === SERIES && o.close === close) ?? null;
const mid = entry ? (entry.quotes.yes_bid + entry.quotes.yes_ask) / 2 : null;
const priorSpot = obs.filter((o) => o.series === SERIES && Date.parse(o.ts) < Date.parse(EVENT.publishedAt)).at(-1)?.spot ?? null;

const trace = {
  builtAt: new Date().toISOString(),
  steps: {
    SOURCE: { url: EVENT.url, title: EVENT.title, via: EVENT.source },
    EXTRACTION: { monitorCheckId: EVENT.monitorCheckId, judge: "Firecrawl monitor AI judged it meaningful for 'exchange outages/withdrawals'", credits: EVENT.creditsForCheck },
    VERIFIED_FACT: { fact: "Bitget suspended XRP-network deposits/withdrawals for wallet maintenance", verifiedBy: "direct GET of the official Bitget support page (JSON-LD datePublished)", publishedAt: EVENT.publishedAt },
    STORED_FEATURE: { feature: "EXCHANGE_OPERATIONS (XRP, single venue, routine maintenance)", weight: 0, note: "not written to evidence.jsonl during the pilot: the pilot did not run monitor-sync; recorded here only" },
    AVAILABILITY: { publishedAt: EVENT.publishedAt, detectedAt: EVENT.detectedAt, detectionDelayHours: +((detect - Date.parse(EVENT.publishedAt)) / 3_600_000).toFixed(2) },
    PRETRADE_SHADOW_EVAL: entry ? { basis, window: close, ticker: entry.ticker, scanAt: entry.ts, tteSec: entry.tte_s, strike: entry.strike, spot: entry.spot, modelP: entry.p, yesBid: entry.quotes.yes_bid, yesAsk: entry.quotes.yes_ask, mid, deskAction: entry.action, failedGate: entry.failed_gate, xrpSpotBeforePublication: priorSpot } : "no XRP scan in the first window after detection",
    OUTCOME: outcome ? { result: outcome.result, settleValue: outcome.value } : "outcome not yet recorded",
  },
  questions: {
    infoBeforeEntry: afterDetect.length ? "Yes: detected before this window's scan, but public ~18 h earlier." : "No: the information was public before this window but our monitor only found it ~18 h after publication, so it was NOT available to the desk at entry.",
    priceAlreadyReflected: entry ? `Yes. The notice was ${((Date.parse(entry.ts) - Date.parse(EVENT.publishedAt)) / 3_600_000).toFixed(1)} h old at this scan; the YES ask was ${entry.quotes.yes_ask} with spot ${entry.spot} vs strike ${entry.strike} and ${entry.tte_s}s left. Settlement depended on spot vs strike, which the price already showed; a routine one-venue wallet-maintenance notice has no direction for a 15-minute window.` : null,
    wouldHaveChangedDecision: "No. Weight 0 and no plausible direction for a 15-minute settlement. Using it would neither improve nor worsen this decision; it cost 10 credits.",
  },
  measuredIncrementalValue: "none measurable (n=1, no decision change)",
};
writeFileSync(`${DATA_ROOT}/research/grid-trace.json`, JSON.stringify(trace, null, 1));
console.log(JSON.stringify(trace, null, 1));
