/**
 * Perps causal-replay simulator over real Kalshi venue 1m/1h candles + historical funding (signed GETs only).
 *   bun scripts/perps/sim.ts [days=7]   → $DATA_ROOT/perps/sim-<ts>.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { simulate, type SimCfg } from "../../src/lib/perps/sim";
import { CURRENT_REPLAY_LABEL } from "../../src/lib/perps/replay-report";
import { loadSimData } from "./load";
import { RISK_CONFIGS } from "../../src/lib/perps/mandate";
import { DATA_ROOT } from "../../src/lib/data-root";
import { macroGateOfficial } from "../../src/lib/desk/macro-calendar";

const days = Number(process.argv[2] ?? 7);
const data = await loadSimData(days);
const base = { makerWaitBars: 5, slipTicks: 2, partialFrac: 0.5, fullFillTicks: 3, maxHoldMin: 240, startEquity: 500 };
const cfgs: SimCfg[] = [];
for (const gate of ["strict9", "aggr7"] as const) for (const entry of ["maker", "taker"] as const) for (const riskPct of RISK_CONFIGS) cfgs.push({ ...base, name: `${gate}/${entry}/${riskPct * 100}%`, riskPct, entry, gate });
// intel variant: official-calendar macroClear, only for decisions after the calendar was actually retrieved (no look-ahead)
const cal = JSON.parse(readFileSync(`${DATA_ROOT}/macro-calendar.json`, "utf8")); const calAt = Date.parse(cal.fetchedAt);
const macroClear = (t: number) => { if (t < calAt) return false; const g = macroGateOfficial(cal, t); return g.available && !g.blocked; };
for (const entry of ["maker", "taker"] as const) cfgs.push({ ...base, name: `aggr7+intel/${entry}/15%`, riskPct: 0.15, entry, gate: "aggr7", macroClear });
const results = data.flatMap((d) => cfgs.map((c) => simulate(d, c)));
const dir = `${DATA_ROOT}/perps`; const f = `${dir}/sim-${Date.now()}.json`;
writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), label: CURRENT_REPLAY_LABEL, note: "1m candles are not a Kalshi book fill", days, base, results }, null, 1));
console.log(f);
console.log("market | cfg | signals | maker misses | trades | net $ | end eq | maxDD% | win% | avgW | avgL | exposure% | avgLev | liq");
for (const r of results) console.log([r.market, r.cfg, r.signals, r.makerMisses, r.trades.length, r.netUsd, r.endEquity, r.maxDdPct, r.winRate == null ? "-" : (r.winRate * 100).toFixed(0), r.avgWin ?? "-", r.avgLoss ?? "-", r.exposurePct, r.avgLev ?? "-", r.liquidations].join(" | "));
