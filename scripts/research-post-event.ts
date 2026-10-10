/**
 * Post-event comparison (round 3.3):  bun scripts/research-post-event.ts --catalyst cpi-2026-10-14T12:30
 * Pre-event MiroFish scenarios (provenance-gated runs only) vs the actual reaction of BTC/ETH/SOL/XRP/gold and vs a
 * news + price-only baseline. Refuses to run before release + 4 h. Read-only: official release page (GET), the
 * collector's recorded index prints, Coinbase public candles as a crypto fallback. Nothing feeds trading.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Archive } from "../src/lib/research/alexandria-archive";
import { fetchText } from "../src/lib/research/pipeline.server";
import { evaluateEvent, parseCpiMoM, parseNowcastMoM, type Point } from "../src/lib/research/post-event";
import { blsReleaseTime } from "../src/lib/research/provenance";

const DIR = process.env.RESEARCH_DIR || "/workspace/data/research";
const OBS = process.env.DESK_OBSERVE_DIR || "/workspace/data/desk-observe";
const arg = (k: string) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : undefined; };
const id = arg("--catalyst") ?? "cpi-2026-10-14T12:30";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const runs = new Archive(DIR).all().filter((x) => x.kind === "simulation" && x.catalyst.id === id && /provenance/.test(x.promptVersion ?? ""));
if (!runs.length) { console.log(JSON.stringify({ status: "no_provenance_gated_runs", catalyst: id })); process.exit(1); }
const eventMs = Date.parse(runs[0].catalyst.when ?? "");
if (Date.now() < eventMs + 240 * 60_000) { console.log(JSON.stringify({ status: "too_early", runsAfter: new Date(eventMs + 240 * 60_000).toISOString(), catalyst: id })); process.exit(2); }
const ev = new Date(eventMs);
const ref = new Date(Date.UTC(ev.getUTCFullYear(), ev.getUTCMonth() - 1, 1));
const refMonth = MONTHS[ref.getUTCMonth()];

// actual print: the official release, verified as THIS release by its own embargo time
const rel = await fetchText("https://www.bls.gov/news.release/cpi.nr0.htm");
const relAt = blsReleaseTime(rel.text);
if (relAt == null || Date.parse(relAt) !== eventMs) { console.log(JSON.stringify({ status: "release_not_verified", releaseTime: relAt })); process.exit(3); }
const actual = parseCpiMoM(rel.text, refMonth);
// expectation: the nowcast archived in the PRE-event seed (never re-fetched after the event)
const seedFile = runs.map((r) => join(DIR, "seeds", `${r.id}.md`)).find((f) => existsSync(f));
const nowcast = seedFile ? parseNowcastMoM(readFileSync(seedFile, "utf8"), `${refMonth} ${ref.getUTCFullYear()}`) : null;
if (actual == null || nowcast == null) { console.log(JSON.stringify({ status: "missing_inputs", actual, nowcast })); process.exit(4); }

const IDX: Record<string, string> = { BTC: "BRTI", ETH: "ETHUSD_RTI", SOL: "SOLUSD_RTI", XRP: "XRPUSD_RTI", GOLD: "Metal.Index.1OZGOLD/USD" };
const prices: Record<string, Point[]> = Object.fromEntries(Object.keys(IDX).map((a) => [a, [] as Point[]]));
const from = eventMs - 5 * 3600_000, to = eventMs + 5 * 3600_000;
for (const f of existsSync(join(OBS, "prints")) ? readdirSync(join(OBS, "prints")) : []) {
  for (const line of readFileSync(join(OBS, "prints", f), "utf8").split("\n")) {
    if (!line) continue;
    try { const p = JSON.parse(line) as { i: string; t: number; v: number }; const a = Object.keys(IDX).find((k) => IDX[k] === p.i); if (a && p.t >= from && p.t <= to) prices[a].push({ ms: p.t, value: p.v }); } catch { /* partial */ }
  }
}
const sources: Record<string, string> = {};
for (const a of ["BTC", "ETH", "SOL", "XRP"]) {
  sources[a] = "collector settlement-index prints";
  if (prices[a].length > 600) continue;
  sources[a] = "Coinbase public 1-min candles (fallback: collector prints missing)";
  prices[a] = [];
  for (let s = from; s < to; s += 300 * 60_000) {
    const e = Math.min(to, s + 300 * 60_000);
    const r = await fetch(`https://api.exchange.coinbase.com/products/${a}-USD/candles?granularity=60&start=${new Date(s).toISOString()}&end=${new Date(e).toISOString()}`, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    const rows = r?.ok ? ((await r.json()) as number[][]) : [];
    for (const c of rows) prices[a].push({ ms: c[0] * 1000, value: c[4] });
  }
}
sources.GOLD = prices.GOLD.length > 600 ? "collector Pyth gold prints" : "none (no public gold fallback) → no_data";
const result = evaluateEvent({ eventMs, surprisePp: Number((actual - nowcast).toFixed(3)), runs: runs.map((r) => ({ id: r.id, scenario: r.scenario ?? "", lean: r.extracted?.lean ?? null, assets: r.assets })), prices });
const out = { catalyst: id, generatedAt: new Date().toISOString(), actualMoM: actual, nowcastMoM: nowcast, priceSources: sources, runs: runs.map((r) => r.id), ...result };
writeFileSync(join(DIR, `post-event-${id.replace(/[:]/g, "")}.json`), JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
