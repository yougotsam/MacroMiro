/**
 * 13-pt confluence diagnosis per market (read-only, public Coinbase candles; gold from the collector's recorded
 * Pyth index prints). BEFORE = what the observation rows carried (evaluator: ~1 h of index prints). AFTER = the
 * collector's Coinbase 15m/1h snapshot with an explicit state. No thresholds changed.   bun scripts/paper/confluence-diag.ts
 */
import { writeFileSync } from "node:fs";
import { installReadOnlyFetch } from "../../src/lib/desk/net-guard";
import { fetchPublicCandles, validateBars } from "../../src/lib/desk/market-data";
import { evaluateSniper, resampleComplete } from "../../src/lib/desk/sniper";
import { minuteBars } from "../../src/lib/desk/features";
import { DATA_ROOT } from "../../src/lib/data-root";
import { dayFiles, ensureDir, readJsonlFiles } from "../../src/lib/paper/files";
import { confState } from "../../src/lib/paper/candidates";

installReadOnlyFetch();
const now = Date.now();
const OBS = `${DATA_ROOT}/desk-observe`;
const PRODUCTS: Record<string, string> = { KXBTC15M: "BTC-USD", KXETH15M: "ETH-USD", KXSOL15M: "SOL-USD", KXXRP15M: "XRP-USD" };
const lastObs = readJsonlFiles<{ series: string; ts: string; confluence: { long: { score: number } } | null }>(dayFiles(OBS, "observations-").slice(-1)).slice(-300);
const lastInd = readJsonlFiles<{ series: string; ts: string; sniper?: Record<string, unknown> }>(dayFiles(OBS, "indicators-").slice(-1));
const out: Record<string, unknown> = {};
for (const series of ["KXBTC15M", "KXETH15M", "KXSOL15M", "KXXRP15M", "KXGOLD15M"]) {
  const before = lastObs.filter((o) => o.series === series).at(-1);
  let b15: Parameters<typeof evaluateSniper>[0] = [], b1h: typeof b15 = [], source = "";
  if (PRODUCTS[series]) {
    b15 = validateBars(await fetchPublicCandles(PRODUCTS[series], 15), 15, now).bars;
    b1h = validateBars(await fetchPublicCandles(PRODUCTS[series], 60), 60, now).bars;
    source = `coinbase ${PRODUCTS[series]} public candles`;
  } else {
    const prints = readJsonlFiles<{ i: string; t: number; v: number }>(dayFiles(`${OBS}/prints`, "")).filter((p) => p.i.includes("GOLD")).map((p) => ({ t: p.t, v: p.v }));
    const m1 = minuteBars(prints as never, now).map((b: { t: number }) => ({ ...b, t: b.t * 60_000 }));
    b15 = resampleComplete(m1 as never, 15); b1h = resampleComplete(m1 as never, 60);
    source = "recorded Pyth gold index prints (no traded volume; no genuine historical candle source wired)";
  }
  const dirs = Object.fromEntries((["long", "short"] as const).map((d) => {
    const e = evaluateSniper(b15, b1h, d, true);
    return [d, { state: confState(e), score: e.score, points: e.points, setup: e.setup, eligibleCore9: e.eligible, missing: e.missing }];
  }));
  const ind = lastInd.filter((r) => r.series === series).at(-1);
  out[series] = {
    source, bars15: b15.length, bars1h: b1h.length, need: { bars15: 60, bars1h: 205 },
    ready: b15.length >= 60 && b1h.length >= 205,
    latest15Close: b15.at(-1) ? new Date(b15.at(-1)!.t + 15 * 60_000).toISOString() : null,
    before: { obsRowScore: before?.confluence?.long?.score ?? null, at: before?.ts ?? null, note: "evaluator path: built from ~1 h of index prints → under warm-up → reported 0 (should be NOT_READY)" },
    after: dirs, lastCollectorSnapshot: ind ? { at: ind.ts, long: confState(ind.sniper?.long as never), short: confState(ind.sniper?.short as never) } : null,
  };
}
writeFileSync(`${ensureDir(`${DATA_ROOT}/paper`)}/confluence-diag.json`, JSON.stringify({ at: new Date(now).toISOString(), markets: out }, null, 1));
console.log(JSON.stringify(out, (k, v) => (k === "points" ? JSON.stringify(v) : v), 1));
