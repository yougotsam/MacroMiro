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
import { replay, LIMITS } from "../../src/lib/paper/portfolio";
import { eventsFor, evaluateEvent, type IntelEvent, type QuotePoint } from "../../src/lib/paper/intel-events";
import type { IndicatorRow } from "../../src/lib/desk/setups";
import { readMode } from "../../src/lib/ops/operating-mode";
import { watchdogFresh } from "../../src/lib/loop/watchdog";
import { P as LOOP } from "../../src/lib/loop/paths";

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

  // our-side bid per ticker over time, for flattening open paper positions when the −$15 day stop hits
  const bids = new Map<string, { ms: number; yes: number | null; no: number | null }[]>();
  for (const o of obs) if (o.ticker && o.exec) { const a = bids.get(o.ticker) ?? []; a.push({ ms: Date.parse(o.ts), yes: o.exec.yes_bid, no: o.exec.no_bid }); bids.set(o.ticker, a); }
  const mark = (ticker: string, side: "yes" | "no", ms: number) => { const a = bids.get(ticker); if (!a) return null; let lo = 0, hi = a.length - 1, best: number | null = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (a[m].ms <= ms) { best = side === "yes" ? a[m].yes : a[m].no; lo = m + 1; } else hi = m - 1; } return best; };
  const all: Candidate[] = [];
  for (const o of obs) all.push(...candidatesOf(o, indAt(o.series, o.ts), researchFor(o)));

  const byTicker = new Map<string, Candidate[]>();
  for (const c of all) byTicker.set(c.ticker, [...(byTicker.get(c.ticker) ?? []), c]);
  const results = CONFIGS.map((cfg) => {
    const taken = new Map<string, Candidate>();
    for (const [t, cs] of byTicker) { const pick = cfg.select(cs); if (pick) taken.set(t, pick); }
    const trades = [...taken.values()].map((c) => {
      const o = outcomes.get(c.ticker);
      const s = o ? settle({ side: c.side, price: c.entryPrice, qty: c.qty, feeMultiplier: c.feeMultiplier }, o.result as "yes" | "no") : null;
      return { ...c, outcome: o?.result ?? null, settleValue: o?.value ?? null, ...(s ? { payout: s.payout, cost: s.cost, feeUsd: s.fee, netUsd: s.net, won: s.won } : { netUsd: null }) };
    });
    const done = trades.filter((t) => t.netUsd != null);
    // independent window = settlement time (the four coins share one window; gold is its own cluster)
    const win = new Map<string, number>();
    for (const t of done) { const k = `${t.close}|${t.series === "KXGOLD15M" ? "gold" : "crypto"}`; win.set(k, (win.get(k) ?? 0) + (t.netUsd as number)); }
    const w = [...win.values()], n = w.length, mean = n ? w.reduce((a, b) => a + b, 0) / n : 0;
    const se = n > 1 ? Math.sqrt(w.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) / n) : null;
    const total = done.reduce((a, t) => a + (t.netUsd as number), 0);
    const portfolio = replay(trades.map((t) => ({ ts: t.ts, ticker: t.ticker, series: t.series, close: t.close, side: t.side, cost: +(t.qty * t.entryPrice).toFixed(4), fee: t.fee, netUsd: t.netUsd, qty: t.qty })), mark);
    const avg = (f: (t: (typeof done)[number]) => number) => (done.length ? +(done.reduce((a, t) => a + f(t), 0) / done.length).toFixed(4) : null);
    const why = { avgEntryPrice: avg((t) => t.entryPrice), avgModelP: avg((t) => t.modelProbExperimental), realizedWinRate: avg((t) => (t.won ? 1 : 0)), avgEvClaimedUsd: avg((t) => t.evUsd), avgNetUsd: avg((t) => t.netUsd as number), cheapSideShare: avg((t) => (t.entryPrice < 0.25 ? 1 : 0)) };
    return { id: cfg.id, label: cfg.label, portfolio, why, entries: trades.length, settled: done.length, open: trades.length - done.length, windows: n, wins: done.filter((t) => t.won).length,
      netUsd: +total.toFixed(2), feesUsd: +done.reduce((a, t) => a + (t.feeUsd ?? 0), 0).toFixed(2), perWindowMeanUsd: +mean.toFixed(3), perWindowSeUsd: se == null ? null : +se.toFixed(3),
      ci95Usd: se == null ? null : [+(total - 1.96 * se * n).toFixed(2), +(total + 1.96 * se * n).toFixed(2)], recent: trades.slice(-40) };
  });

  // ranked opportunities: latest scan per market
  const latestTs = new Map<string, string>();
  for (const o of obs) latestTs.set(o.series, o.ts);
  const fresh = (ts: string) => Date.now() - Date.parse(ts) <= 120_000;
  // fail closed: a stale risk-watchdog heartbeat, or a paper kill for today, refuses every NEW paper entry
  const wd = watchdogFresh();
  const kill = (() => { try { const k = JSON.parse(readFileSync(LOOP.paperKill(), "utf8")); return k.day === new Date(Date.now() - 4 * 3_600_000).toISOString().slice(0, 10) ? k : null; } catch { return null; } })();
  const blockNew = !wd.ok ? `rejected: ${wd.why} (fail-closed)` : kill ? `rejected: paper kill (${kill.reason})` : null;
  const ranked = all.filter((c) => latestTs.get(c.series) === c.ts && fresh(c.ts)).sort((a, b) => b.score - a.score)
    .map((c) => ({ ...c, wouldEnter: blockNew ? [] : CONFIGS.filter((cfg) => cfg.select([c]) === c).map((cfg) => cfg.id), reason: blockNew ? blockNew : c.evPerContract <= 0 ? `rejected: EV ${c.evPerContract.toFixed(3)} ≤ 0 after fees` : c.tteSec < 60 ? "rejected: < 60 s left" : "EV > 0 (paper only)" }));
  let status: Record<string, unknown> = {};
  try { status = JSON.parse(readFileSync(`${OBS}/observe-status.json`, "utf8")); } catch { /* none */ }
  const lastRows = readJsonlFiles<ObsRow & { index?: { age_ms: number | null } }>(dayFiles(OBS, "observations-").slice(-1)).slice(-400);
  const feed: Record<string, unknown> = {};
  for (const r of lastRows) feed[r.series] = { at: r.ts, ticker: r.ticker, yesAsk: r.exec?.yes_ask ?? null, noAsk: r.exec?.no_ask ?? null, spot: r.spot, indexAgeMs: r.index?.age_ms ?? null, gate: r.failed_gate, stale: r.exec == null || r.index?.age_ms == null || (r.index.age_ms ?? 1e9) > 5000 };
  const out = {
    generatedAt: new Date().toISOString(),
    label: "PAPER ONLY. This script does not send. Live orders are the desk engine and the perpetual button. Scores here are not a live fill.",
    mode: readMode(), collector: { pid: status.pid ?? null, lastTickAt: status.lastTickAt ?? null, rows: status.rows ?? null, errors: status.errors ?? null, lastError: status.lastError ?? null },
    watchdog: { ...wd, paperKill: kill }, feed, weights: WEIGHTS, scansWithModelAndQuotes: obs.length, candidates: all.length, ranked,
    configs: results,
    limits: LIMITS, confluenceDiag: (() => { try { return JSON.parse(readFileSync(`${OUT}/confluence-diag.json`, "utf8")); } catch { return null; } })(),
    rejectedExample: all.find((c) => latestTs.get(c.series) === c.ts && c.evPerContract <= 0) ?? all.findLast((c) => c.evPerContract <= 0) ?? null,
    research: { events: events.map((e) => evaluateEvent(e, new Date().toISOString(), quotes)), changedDecisions: (() => { const c = results.find((r) => r.id === "C_time_ranked")!, e = results.find((r) => r.id === "E_research")!; return e.recent.filter((x, i) => c.recent[i]?.ticker !== x.ticker || c.recent[i]?.side !== x.side).length; })() },
  };
  writeFileSync(`${OUT}/paper-latest.json.tmp`, JSON.stringify(out));
  writeFileSync(`${OUT}/paper-latest.json`, JSON.stringify(out));
  return out;
}

const li = process.argv.indexOf("--loop");
const r = once();
console.log(JSON.stringify({ scans: r.scansWithModelAndQuotes, candidates: r.candidates, configs: r.configs.map(({ recent, ...x }) => x) }, null, 1));
if (li >= 0) setInterval(once, Math.max(30, Number(process.argv[li + 1]) || 60) * 1000);
