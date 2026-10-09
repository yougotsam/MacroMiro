/**
 * Collector sample accounting (Phase 1b). Repeated scans of one contract are NOT independent evidence, and the four
 * crypto contracts closing in the same 15-minute window move together — so the sample is counted four ways.
 */
export type ObsRow = {
  ticker?: string | null; series?: string; close?: string | null; ts?: string; rejected?: boolean; failed_gate?: string | null;
  exec?: { complete?: boolean; yes_bid?: number | null; yes_ask?: number | null; no_bid?: number | null; no_ask?: number | null; yes_ask_size?: number | null; no_ask_size?: number | null; yes_bid_size?: number | null; no_bid_size?: number | null } | null;
  threshold?: { strike?: number | null } | null; strike?: number | null;
  index?: { value?: number | null; age_ms?: number | null } | null;
  fee_type?: string | null; fee_multiplier?: number | null;
};
/** a quote is "fresh-index" only when the settlement index print is under this age */
export const INDEX_FRESH_MS = 60_000;
export const FIELDS = ["yes_bid_ask", "no_bid_ask", "depth", "threshold", "index", "fee", "outcome"] as const;
type Field = (typeof FIELDS)[number];
const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
export function rowFields(r: ObsRow, settled: Set<string>): Record<Field, boolean> {
  const e = r.exec ?? {};
  return {
    yes_bid_ask: num(e.yes_bid) && num(e.yes_ask),
    no_bid_ask: num(e.no_bid) && num(e.no_ask),
    depth: num(e.yes_ask_size) && num(e.no_ask_size),
    threshold: num(r.threshold?.strike ?? r.strike),
    index: num(r.index?.value) && num(r.index?.age_ms) && (r.index!.age_ms as number) < INDEX_FRESH_MS,
    fee: !!r.fee_type && num(r.fee_multiplier),
    outcome: !!r.ticker && settled.has(r.ticker),
  };
}
const isGold = (s: string) => /GOLD/i.test(s);
export type OutcomeRow = { ticker: string; series?: string; close?: string; result?: string };

export const TARGET_WINDOWS = 200;
const CRYPTO = new Set(["KXBTC15M", "KXETH15M", "KXSOL15M", "KXXRP15M"]);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function collectorStats(rows: ObsRow[], outcomes: OutcomeRow[], now = Date.now()) {
  const scanRows = rows.filter((r) => r.ticker);
  const perTicker = new Map<string, number>();
  for (const r of scanRows) perTicker.set(r.ticker!, (perTicker.get(r.ticker!) ?? 0) + 1);
  const complete = new Set(scanRows.filter((r) => r.exec?.complete).map((r) => r.ticker!));
  const observedWindows = new Set(scanRows.map((r) => r.close).filter(Boolean));
  const settled = outcomes.filter((o) => o.result === "yes" || o.result === "no");
  const settledObserved = settled.filter((o) => complete.has(o.ticker));
  const closeOf = (o: OutcomeRow) => o.close ?? o.ticker.split("-")[1];
  const windows = new Map<string, Map<string, string>>();
  for (const o of settledObserved) {
    const w = closeOf(o);
    if (!windows.has(w)) windows.set(w, new Map());
    windows.get(w)!.set(o.series ?? o.ticker.split("-")[0], o.result!);
  }
  // correlation of crypto outcomes inside a window
  let pairs = 0, agree = 0, allSame = 0, cryptoWindows = 0;
  for (const m of windows.values()) {
    const c = [...m.entries()].filter(([s]) => CRYPTO.has(s)).map(([, r]) => r);
    if (c.length >= 2) {
      cryptoWindows += 1;
      if (c.every((r) => r === c[0])) allSame += 1;
      for (let i = 0; i < c.length; i += 1) for (let j = i + 1; j < c.length; j += 1) { pairs += 1; if (c[i] === c[j]) agree += 1; }
    }
  }
  const spreads = new Map<string, number[]>();
  for (const r of scanRows) {
    const b = r.exec?.yes_bid, a = r.exec?.yes_ask;
    if (typeof a === "number" && typeof b === "number" && r.series) spreads.set(r.series, [...(spreads.get(r.series) ?? []), Math.round((a - b) * 100) / 100]);
  }
  const gates: Record<string, number> = {};
  for (const r of scanRows) if (r.rejected && r.failed_gate) gates[r.failed_gate] = (gates[r.failed_gate] ?? 0) + 1;
  // independent clusters: crypto (4 coins) at one settlement time = 1; gold at that time = 1 separate
  const settledSet = new Set(settled.map((o) => o.ticker));
  const fieldRows: Record<Field, number> = Object.fromEntries(FIELDS.map((f) => [f, 0])) as Record<Field, number>;
  let allRows = 0;
  const marketAll = new Set<string>();
  for (const r of scanRows) {
    const f = rowFields(r, settledSet);
    for (const k of FIELDS) if (f[k]) fieldRows[k] += 1;
    if (FIELDS.every((k) => f[k])) { allRows += 1; marketAll.add(r.ticker!); }
  }
  const clusters = { crypto: new Map<string, { markets: number; full: number }>(), gold: new Map<string, { markets: number; full: number }>() };
  for (const o of settled) {
    const s = o.series ?? o.ticker.split("-")[0];
    const m = (isGold(s) ? clusters.gold : clusters.crypto);
    const k = closeOf(o);
    const c = m.get(k) ?? { markets: 0, full: 0 };
    c.markets += 1;
    if (marketAll.has(o.ticker)) c.full += 1;
    m.set(k, c);
  }
  const count = (m: Map<string, { markets: number; full: number }>) => ({ settled: m.size, withAnyCompleteMarket: [...m.values()].filter((c) => c.full > 0).length });
  const pct = (x: number) => (scanRows.length ? Math.round((x / scanRows.length) * 1000) / 10 : null);
  const completeness = {
    rowsPctByField: Object.fromEntries(FIELDS.map((f) => [f, pct(fieldRows[f])])),
    rowsAllFieldsPct: pct(allRows),
    marketsWithAFullyCompleteRow: marketAll.size,
    note: `index counts only when the settlement-index print is < ${INDEX_FRESH_MS / 1000}s old; outcome only once Kalshi finalizes`,
  };
  const independentClusters = { crypto: count(clusters.crypto), gold: count(clusters.gold), settlementTimes: windows.size };

  const completedWindows = windows.size;
  const remaining = Math.max(0, TARGET_WINDOWS - completedWindows);
  return {
    repeatedScans: { rows: scanRows.length, perTickerMean: perTicker.size ? Math.round((scanRows.length / perTicker.size) * 10) / 10 : 0, perTickerMax: Math.max(0, ...perTicker.values()) },
    uniqueMarkets: { observed: perTicker.size, completeExecutableQuotes: complete.size, settledWithCompleteQuotes: settledObserved.length },
    independentClosingWindows: { observed: observedWindows.size, completed: completedWindows, target: TARGET_WINDOWS, remaining, etaHours: remaining * 0.25, etaAt: new Date(now + remaining * 900_000).toISOString() },
    correlatedOutcomes: {
      cryptoWindows, allFourSameDirection: allSame, pairwiseAgreement: pairs ? Math.round((agree / pairs) * 1000) / 1000 : null,
      note: "agreement near 1 means the 4 crypto outcomes in a window behave like ~1 independent bet, not 4",
    },
    independentClusters,
    completeness,
    medianYesSpreadBySeries: Object.fromEntries([...spreads.entries()].map(([s, xs]) => [s, median(xs)])),
    rejectedByGate: gates,
  };
}
