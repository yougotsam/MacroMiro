/**
 * Report-only replay (non-blocking): settlement model vs market price on recently settled 15m crypto contracts.
 * Uses Kalshi's CF Benchmarks history passthrough (5 Hz → 1 s prints) and 1-minute market candlesticks.
 *   bun scripts/desk-replay.ts [hours=6]
 * Writes <desk data>/replay-report.json. Brier is reported; nothing here gates trading.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { REFERENCE, dataDir, type Series } from "../src/lib/desk/config";
import { clampP, cryptoProb, SIGMA_FLOOR, sigmaFromPrints, type Print } from "../src/lib/desk/settlement";
import { kalshiGet } from "../src/lib/scan/kalshi-auth";

const HOURS = Number(process.argv[2] ?? 6);
const PUB = "https://api.elections.kalshi.com/trade-api/v2";
const CRYPTO: Series[] = ["KXBTC15M", "KXETH15M", "KXSOL15M", "KXXRP15M"];
const OFFSETS = [300, 120, 45];

type M = { ticker: string; close_time: string; floor_strike?: number; result?: string };
const pub = async <T>(p: string): Promise<T> => (await (await fetch(`${PUB}${p}`, { signal: AbortSignal.timeout(15_000) })).json()) as T;

async function hourPrints(index: string, hourStartMs: number): Promise<Print[]> {
  const ts = new Date(hourStartMs).toISOString();
  const { data } = await kalshiGet<{ data?: { payload?: Array<{ time: number; value: string }> } }>(
    `/trade-api/v2/cfbenchmarks/history/values?id=${encodeURIComponent(index)}&timespan=HOUR&timestamp=${encodeURIComponent(ts)}`,
  );
  return (data.data?.payload ?? []).filter((r) => r.time % 1000 === 0).map((r) => ({ t: r.time, v: Number(r.value) }));
}

const rows: Array<Record<string, unknown>> = [];
const now = Date.now();
for (const series of CRYPTO) {
  const ref = REFERENCE[series];
  const { markets = [] } = await pub<{ markets?: M[] }>(`/markets?series_ticker=${series}&status=settled&limit=100`);
  const recent = markets.filter((m) => now - Date.parse(m.close_time) < HOURS * 3600_000 && (m.result === "yes" || m.result === "no") && m.floor_strike);
  if (!recent.length) continue;
  const hours = new Set<number>();
  for (const m of recent) {
    const c = Date.parse(m.close_time);
    for (const h of [c - 3 * 3600_000, c - 2 * 3600_000, c - 3600_000, c]) hours.add(Math.floor(h / 3600_000) * 3600_000);
  }
  const prints: Print[] = [];
  for (const h of [...hours].sort()) {
    try {
      prints.push(...(await hourPrints(ref.index, h)));
    } catch {
      /* hour unavailable */
    }
  }
  prints.sort((a, b) => a.t - b.t);
  for (const m of recent) {
    const closeMs = Date.parse(m.close_time);
    let candles: Array<{ end_period_ts: number; yes_bid?: { close_dollars?: string }; yes_ask?: { close_dollars?: string } }> = [];
    try {
      const { data } = await kalshiGet<{ candlesticks?: typeof candles }>(
        `/trade-api/v2/series/${series}/markets/${m.ticker}/candlesticks?start_ts=${Math.floor(closeMs / 1000) - 900}&end_ts=${Math.floor(closeMs / 1000)}&period_interval=1`,
      );
      candles = data.candlesticks ?? [];
    } catch {
      candles = [];
    }
    for (const off of OFFSETS) {
      const t = closeMs - off * 1000;
      const upto = prints.filter((p) => p.t <= t);
      const last = upto.at(-1);
      if (!last || t - last.t > 5_000) continue;
      const sig = sigmaFromPrints(upto.slice(-3600), t, SIGMA_FLOOR[ref.index] ?? 0);
      if (sig.sigma == null) continue;
      const w = new Map<number, number>();
      for (const p of upto) if (p.t >= closeMs - 60_000) w.set(p.t, p.v);
      const p = clampP(cryptoProb({ closeMs, strike: m.floor_strike!, dp: ref.dp, last, windowPrints: w, sigma: sig.sigma }).p);
      const c = [...candles].filter((x) => x.end_period_ts * 1000 <= t).at(-1);
      const bid = Number(c?.yes_bid?.close_dollars ?? NaN);
      const ask = Number(c?.yes_ask?.close_dollars ?? NaN);
      const mkt = bid > 0 && ask > 0 && ask < 1 && ask - bid <= 0.1 ? (bid + ask) / 2 : null;
      const y = m.result === "yes" ? 1 : 0;
      rows.push({ series, ticker: m.ticker, off, p, mkt, y, bm: (p - y) ** 2, bk: mkt == null ? null : (mkt - y) ** 2 });
    }
  }
}
const both = rows.filter((r) => r.bk != null);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const by = (k: string) =>
  Object.fromEntries(
    [...new Set(both.map((r) => String(r[k])))].map((v) => {
      const sub = both.filter((r) => String(r[k]) === v);
      return [v, { n: sub.length, brierModel: avg(sub.map((r) => r.bm as number)), brierMarket: avg(sub.map((r) => r.bk as number)) }];
    }),
  );
const report = {
  generatedAt: new Date().toISOString(),
  hours: HOURS,
  n: both.length,
  brierModel: avg(both.map((r) => r.bm as number)),
  brierMarket: avg(both.map((r) => r.bk as number)),
  bySeries: by("series"),
  byOffsetSec: by("off"),
  note: "report-only; market = 1-minute candle mid at or before the evaluation time (spread ≤ 10¢)",
};
mkdirSync(dataDir(), { recursive: true });
writeFileSync(`${dataDir()}/replay-report.json`, JSON.stringify({ report, rows }, null, 2));
console.log(JSON.stringify(report, null, 2));
