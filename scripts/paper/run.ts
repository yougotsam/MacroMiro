/**
 * Paper research run (0 credits, read-only files). Builds ranked candidates from the collector's real quotes,
 * settles paper entries against Kalshi outcomes in USD, and compares entry configs (A/B/C + timing).
 *   bun scripts/paper/run.ts            one pass → <DATA_ROOT>/paper/paper-latest.json
 *   bun scripts/paper/run.ts --loop 60  repeat every 60 s (paper only)
 * No order path: this script imports no OMS/engine/kalshi-write code (test-enforced).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { DATA_ROOT } from "../../src/lib/data-root";
import { dayFiles, ensureDir, readJsonlFiles } from "../../src/lib/paper/files";
import { candidatesOf, CONFIGS, WEIGHTS, type Candidate, type ObsRow } from "../../src/lib/paper/candidates";
import { settle } from "../../src/lib/paper/pnl";
import { eventsFor, evaluateEvent, type IntelEvent, type QuotePoint } from "../../src/lib/paper/intel-events";
import type { IndicatorRow } from "../../src/lib/desk/setups";
import { readMode } from "../../src/lib/ops/operating-mode";

const OBS = `${DATA_ROOT}/desk-observe`;
const OUT = ensureDir(`${DATA_ROOT}/paper`);

function once() {
  const obs = readJsonlFiles<ObsRow>(dayFiles(OBS, "observations-"), (l) => l.includes('"exec":{') && !l.includes('"p":null')).sort((a, b) => a.ts.localeCompare(b.ts));
  const outcomes = new Map(readJsonlFiles<{ ticker: string; result: string; value: number; close: string }>(dayFiles(OBS, "outcomes-")).filter((o) => o.result === "yes" || o.result === "no").map((o) => [o.ticker, o]));
  const ind = readJsonlFiles<IndicatorRow>(dayFiles(OBS, "indicators-")).map((r) => ({ ...r, ms: Date.parse(r.ts) })).sort((a, b) => a.ms - b.ms);
  const indBy = new Map<string, typeof ind>();
  for (const r of ind) indBy.set(r.series, [...(indBy.get(r.series) ?? []), r]);
  const events = readJsonlFiles<IntelEvent>(dayFiles(`${DATA_ROOT}/research`, "intel-events"));
  const quotes: QuotePoint[] = obs.filter((o) => o.exec?.yes_bid != null && o.exec?.yes_ask != null).map((o) => ({ ts: o.ts, series: o.series, mid: (o.exec!.yes_bid! + o.exec!.yes_ask!) / 2 }));

  const indAt = (series: string, ts: string) => {
    const xs = indBy.get(series) ?? [], t = Date.parse(ts);
    let lo = 0, hi = xs.length - 1, best = null as (typeof xs)[number] | null;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (xs[mid].ms <= t) { best = xs[mid]; lo = mid + 1; } else hi = mid - 1; }
    return best && t - best.ms <= 120_000 ? best : null;
  };
  const researchFor = (o: ObsRow) => {
    const ev = eventsFor(o.series, o.ts, events);
    const dirEv = ev.filter((e) => e.direction);
    // EXPERIMENTAL: +/-2¢ per directional, detected-before-decision event. None exists yet → 0.
    return { adj: (side: "yes" | "no") => dirEv.reduce((a, e) => a + ((e.direction === "up") === (side === "yes") ? 0.02 : -0.02), 0), note: ev.length ? `${ev.length} event(s) detected before this scan: ${ev.map((e) => e.id).join(", ")}` : "no timely research event" };
  };

  const all: Candidate[] = [];
  for (const o of obs) all.push(...candidatesOf(o, indAt(o.series, o.ts), researchFor(o)));

  const results = CONFIGS.map((cfg) => {
    const taken = new Map<string, Candidate>();
    for (const c of all) {
      if (taken.has(c.ticker) || !cfg.enter(c)) continue;
      taken.set(c.ticker, c);
    }
    const trades = [...taken.values()].map((c) => {
      const o = outcomes.get(c.ticker);
      const s = o ? settle({ side: c.side, price: c.entryPrice, qty: c.qty, feeMultiplier: 1 }, o.result as "yes" | "no") : null;
      return { ...c, outcome: o?.result ?? null, settleValue: o?.value ?? null, ...(s ? { payout: s.payout, cost: s.cost, feeUsd: s.fee, netUsd: s.net, won: s.won } : { netUsd: null }) };
    });
    const done = trades.filter((t) => t.netUsd != null);
    // independent window = settlement time (the four coins share one window; gold is its own cluster)
    const win = new Map<string, number>();
    for (const t of done) { const k = `${t.close}|${t.series === "KXGOLD15M" ? "gold" : "crypto"}`; win.set(k, (win.get(k) ?? 0) + (t.netUsd as number)); }
    const w = [...win.values()], n = w.length, mean = n ? w.reduce((a, b) => a + b, 0) / n : 0;
    const se = n > 1 ? Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) / n) : null;
    const total = done.reduce((a, t) => a + (t.netUsd as number), 0);
    return { id: cfg.id, label: cfg.label, entries: trades.length, settled: done.length, open: trades.length - done.length, windows: n, wins: done.filter((t) => t.won).length,
      netUsd: +total.toFixed(2), feesUsd: +done.reduce((a, t) => a + (t.feeUsd ?? 0), 0).toFixed(2), perWindowMeanUsd: +mean.toFixed(3), perWindowSeUsd: se == null ? null : +se.toFixed(3),
      ci95Usd: se == null ? null : [+(total - 1.96 * se * n).toFixed(2), +(total + 1.96 * se * n).toFixed(2)], recent: trades.slice(-40) };
  });

  // ranked opportunities: latest scan per market
  const latestTs = new Map<string, string>();
  for (const o of obs) latestTs.set(o.series, o.ts);
  const fresh = (ts: string) => Date.now() - Date.parse(ts) <= 120_000;
  const ranked = all.filter((c) => latestTs.get(c.series) === c.ts && fresh(c.ts)).sort((a, b) => b.score - a.score);
  let status: Record<string, unknown> = {};
  try { status = JSON.parse(readFileSync(`${OBS}/observe-status.json`, "utf8")); } catch { /* none */ }
  const lastRows = readJsonlFiles<ObsRow & { index?: { age_ms: number | null } }>(dayFiles(OBS, "observations-").slice(-1)).slice(-400);
  const feed: Record<string, unknown> = {};
  for (const r of lastRows) feed[r.series] = { at: r.ts, ticker: r.ticker, yesAsk: r.exec?.yes_ask ?? null, noAsk: r.exec?.no_ask ?? null, spot: r.spot, indexAgeMs: r.index?.age_ms ?? null, gate: r.failed_gate, stale: r.exec == null || r.index?.age_ms == null || (r.index.age_ms ?? 1e9) > 5000 };
  const out = {
    generatedAt: new Date().toISOString(),
    label: "PAPER ONLY. Real orders are disabled (CALIBRATED_MODEL_APPROVED=false). Scores and probabilities are EXPERIMENTAL unless marked CALIBRATED.",
    mode: readMode(), collector: { pid: status.pid ?? null, lastTickAt: status.lastTickAt ?? null, rows: status.rows ?? null, errors: status.errors ?? null, lastError: status.lastError ?? null },
    feed, weights: WEIGHTS, scansWithModelAndQuotes: obs.length, candidates: all.length, ranked,
    configs: results,
    research: { events: events.map((e) => evaluateEvent(e, new Date().toISOString(), quotes)), changedDecisions: results.find((r) => r.id === "C_research")!.entries - results.find((r) => r.id === "B_setups")!.entries },
  };
  writeFileSync(`${OUT}/paper-latest.json.tmp`, JSON.stringify(out));
  writeFileSync(`${OUT}/paper-latest.json`, JSON.stringify(out));
  return out;
}

const li = process.argv.indexOf("--loop");
const r = once();
console.log(JSON.stringify({ scans: r.scansWithModelAndQuotes, candidates: r.candidates, configs: r.configs.map(({ recent, ...x }) => x) }, null, 1));
if (li >= 0) setInterval(once, Math.max(30, Number(process.argv[li + 1]) || 60) * 1000);
