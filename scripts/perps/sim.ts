/**
 * Perps causal-replay simulator over real Kalshi venue 1m/1h candles + historical funding (signed GETs only).
 *   bun scripts/perps/sim.ts [days=7]   → $DATA_ROOT/perps/sim-<ts>.json
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { perpsReader, signedGet, type PerpCandle } from "../../src/lib/perps/kalshi-perps-read";
import { simulate, type SimCfg, type SimData } from "../../src/lib/perps/sim";
import { cleanBars } from "../../src/lib/perps/candidates";
import { RISK_CONFIGS } from "../../src/lib/perps/mandate";
import { DATA_ROOT } from "../../src/lib/data-root";
import { macroGateOfficial } from "../../src/lib/desk/macro-calendar";

const days = Number(process.argv[2] ?? 7);
const R = perpsReader();
const MARKETS: Record<string, string> = { KXBTCPERP: "crypto_major", KXETHPERP: "crypto_major", KXGOLDPERP: "metals", KXSOLPERP: "crypto_major", KXXRPPERP: "crypto_major" };
const nowS = Math.floor(Date.now() / 1000);
const cacheDir = `${DATA_ROOT}/perps/cache`; mkdirSync(cacheDir, { recursive: true });
async function paged(t: string, period: 1 | 60, spanS: number) {
  const f = `${cacheDir}/${t}-${period}-${days}d.json`;
  if (existsSync(f) && Date.now() - JSON.parse(readFileSync(f, "utf8")).at < 3 * 3600_000) return JSON.parse(readFileSync(f, "utf8")).bars as PerpCandle[];
  const out: PerpCandle[] = []; const step = period === 1 ? 4 * 3600 : 200 * 3600;
  for (let s = nowS - spanS; s < nowS; s += step) out.push(...(await R.candles(t, period, s, Math.min(nowS, s + step))));
  const seen = new Set<number>(); const bars = out.filter((k) => (seen.has(k.t) ? false : (seen.add(k.t), true))).sort((a, b) => a.t - b.t).filter((k) => k.t + period * 60_000 <= Date.now());
  writeFileSync(f, JSON.stringify({ at: Date.now(), bars })); return bars;
}
const [fees, risk] = await Promise.all([R.feeTiers(), signedGet("/risk_parameters") as Promise<any>]);
const status = JSON.parse(readFileSync(`${DATA_ROOT}/perps/collector-status.json`, "utf8"));
const data: SimData[] = [];
for (const [t, group] of Object.entries(MARKETS)) {
  const mk: any = ((await signedGet(`/markets/${t}`)) as any).market;
  const market = (await R.market(t));
  const m1raw = await paged(t, 1, days * 86400 + 16 * 3600); const h1 = await paged(t, 60, days * 86400 + 240 * 3600);
  const { bars: m1, dropped } = cleanBars(m1raw);
  const fh = await R.fundingHistory(t, nowS - days * 86400 - 86400, nowS);
  const top = status.books?.[t]; const spreadHalf = top?.bestBid && top?.bestAsk ? (top.bestAsk - top.bestBid) / 2 : market.tick;
  data.push({ market, m1, h1, spreadHalf, funding: fh.map((f) => ({ tMs: Date.parse(f.funding_time), rate: Number(f.funding_rate) })), maker: fees.maker_fee_rates[t], taker: fees.taker_fee_rates[t], group,
    spec: { leverage: mk.leverage_estimates, initialMultiplier: Number(risk.initial_margin_multiplier?.[t] ?? 1.3), liqThreshold: Number(risk.liquidation_margin_ratio_threshold ?? 1) } });
  console.error(t, "m1", m1.length, "dropped", dropped, "h1", h1.length, "funding pts", fh.length, "spreadHalf", spreadHalf);
}
const base = { makerWaitBars: 5, slipTicks: 2, partialFrac: 0.5, fullFillTicks: 3, maxHoldMin: 240, startEquity: 500 };
const cfgs: SimCfg[] = [];
for (const gate of ["strict9", "aggr7"] as const) for (const entry of ["maker", "taker"] as const) for (const riskPct of RISK_CONFIGS) cfgs.push({ ...base, name: `${gate}/${entry}/${riskPct * 100}%`, riskPct, entry, gate });
// intel variant: official-calendar macroClear, only for decisions after the calendar was actually retrieved (no look-ahead)
const cal = JSON.parse(readFileSync(`${DATA_ROOT}/macro-calendar.json`, "utf8")); const calAt = Date.parse(cal.fetchedAt);
const macroClear = (t: number) => { if (t < calAt) return false; const g = macroGateOfficial(cal, t); return g.available && !g.blocked; };
for (const entry of ["maker", "taker"] as const) cfgs.push({ ...base, name: `aggr7+intel/${entry}/15%`, riskPct: 0.15, entry, gate: "aggr7", macroClear });
const results = data.flatMap((d) => cfgs.map((c) => simulate(d, c)));
const dir = `${DATA_ROOT}/perps`; const f = `${dir}/sim-${Date.now()}.json`;
writeFileSync(f, JSON.stringify({ at: new Date().toISOString(), label: "CAUSAL REPLAY on Kalshi venue 1m candles (not live fills)", days, base, results }, null, 1));
console.log(f);
console.log("market | cfg | signals | maker misses | trades | net $ | end eq | maxDD% | win% | avgW | avgL | exposure% | avgLev | liq");
for (const r of results) console.log([r.market, r.cfg, r.signals, r.makerMisses, r.trades.length, r.netUsd, r.endEquity, r.maxDdPct, r.winRate == null ? "-" : (r.winRate * 100).toFixed(0), r.avgWin ?? "-", r.avgLoss ?? "-", r.exposurePct, r.avgLev ?? "-", r.liquidations].join(" | "));
