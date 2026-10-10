/**
 * P6/P7 ROI: shadow configs A/B/C from the existing leakage-free evaluation (npm run desk:evaluate, 82437b7) plus the
 * research-feature coverage, and budget tiers from MEASURED usage. 0 credits. `bun scripts/grid/roi.ts`
 *   A = settlement probability + Kalshi executable price
 *   B = A + sniper setups (per named setup; CONFLUENCE_7PLUS as the combined gate)
 *   C = B + verified research features available BEFORE each decision (weights 0 → identical to B unless a feature exists)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DATA_ROOT } from "../../src/lib/data-root";
import { readEvidence } from "../../src/lib/grid/evidence";

const ev = JSON.parse(readFileSync(`${DATA_ROOT}/desk-observe/evaluation-latest.json`, "utf8"));
const obsDay = (d: string) => { try { return readFileSync(`${DATA_ROOT}/desk-observe/observations-${d}.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { ts: string; close: string; series: string }); } catch { return []; } };
const obs = [...obsDay("2026-10-08"), ...obsDay("2026-10-09"), ...obsDay("2026-10-10")];
const closes = [...new Set(obs.map((o) => o.close))].map((c) => Date.parse(c)).sort();
const CRYPTO_OR_GOLD = /bitcoin|btc|ether|eth|solana|sol|xrp|gold|crypto|exchange/i;
const evidence = readEvidence();
// A feature counts for a window only if it was available (detected) before that window closed and is about our assets.
const usable = evidence.filter((e) => e.detectedAt && CRYPTO_OR_GOLD.test(`${e.title} ${e.summary ?? ""}`));
const windowsWithFeature = closes.filter((c) => usable.some((e) => Date.parse(e.detectedAt) < c && c - Date.parse(e.detectedAt) < 6 * 3_600_000)).length;

const A = { brierModel: ev.settlementOnly.vsKalshiImplied.brierModel, brierKalshi: ev.settlementOnly.vsKalshiImplied.brierMarket, skillVsKalshi: ev.settlementOnly.vsKalshiImplied.bss, skillCi95: ev.settlementOnly.vsKalshiImplied.ci95, afterCost: ev.settlementOnly.takerAfterCost };
const B = Object.fromEntries(Object.entries(ev.technicalConfluence.setups as Record<string, { contracts: number; windows: number; takerAfterCost: unknown; verdict: string; credibleImprovement: boolean }>).map(([k, v]) => [k, { contracts: v.contracts, windows: v.windows, afterCost: v.takerAfterCost, verdict: v.verdict, credible: v.credibleImprovement }]));
const C = { windowsEvaluated: closes.length, windowsWithAnyVerifiedResearchFeatureBefore: windowsWithFeature, decisionsChangedVsB: 0, reason: windowsWithFeature ? "features exist for some windows but all weights are 0, so no decision changes" : "no verified, asset-relevant research feature was available before any evaluated window; C is identical to B", afterCost: "same as B" };

// Measured usage (authoritative account + job records, Oct 9 2026). See docs/FIRECRAWL_SOURCE_REGISTRY.md.
const measured = {
  octoberUsedSoFar: 6626, daysElapsed: 9.2, legacyBriefPerRunAvg: 67.5, legacyBriefRunsPerDayObserved: 15, clerkRunAvg: 21, pilotMonitorCreditsPerCheck: { releasePages: 4, webSearch: 10 },
  e2eCatalystInvestigation: 72, alexandriaPaidCall: 5,
};
const tiers = [
  { tier: "1 data collection only", monthly: 0, what: "Kalshi collector + free official calendars/RSS. FULL_STANDBY or MARKET_DATA_ONLY.", marginalBenefit: "baseline; the trading model is evaluated entirely on this data today" },
  { tier: "2 lean event-driven research", monthly: 900, what: "per scheduled release (≈8–10 CPI/PPI/jobs/FOMC/PCE/GDP per month): 1 Alexandria actual+revision (5), 2 scrapes+diff (2), 1 Spark 2 v2 low/medium (≈30–70); plus ~100 on-demand searches", marginalBenefit: "only path that could create a testable MACRO_SURPRISE feature; value unproven until ≥ ~30 matched releases (~3–4 months)" },
  { tier: "3 expanded active research", monthly: 4500, what: "tier 2 + web-search monitor every 6 h (~1,200) + release-page monitor every 6 h (~500) + daily Spark brief (~2,000)", marginalBenefit: "pilot: 7 'meaningful' search hits in 3 h, 0 relevant to a 15-minute settlement; no measured benefit" },
  { tier: "4 high-frequency event monitoring", monthly: 21000, what: "legacy brief every 90 min (what was actually running) + monitors at 2–3 h", marginalBenefit: "none measured; this is roughly the October pace before FULL_STANDBY" },
];
const out = { generatedAt: new Date().toISOString(), label: ev.label, windows: ev.windows, A, B, C, timing: ev.timing, mirofish: "not evaluated: too few completed real simulations with matched outcomes (CPI Oct 14 pending)", measured, tiers, minimumJustified: "tier 1 (0/month) now; tier 2 (~900/month) only for scheduled releases if Sameer approves, re-judged after ~30 releases" };
writeFileSync(`${DATA_ROOT}/research/grid-roi.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ A, C, B: Object.fromEntries(Object.entries(B).map(([k, v]) => [k, `${(v.afterCost as { trades: number; total: number }).trades} trades ${(v.afterCost as { total: number }).total}`])) }, null, 1));
