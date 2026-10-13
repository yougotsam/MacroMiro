/**
 * Shared loader for the perps causal replay (used by scripts/perps/sim.ts and scripts/loop/ab-replay.ts).
 * Signed Kalshi GETs only; candles cached under $DATA_ROOT/perps/cache for 3 h. No order paths.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { perpsReader, signedGet, type PerpCandle } from "../../src/lib/perps/kalshi-perps-read";
import type { SimData } from "../../src/lib/perps/sim";
import { cleanBars } from "../../src/lib/perps/candidates";
import { DATA_ROOT } from "../../src/lib/data-root";

export const MARKETS: Record<string, string> = { KXBTCPERP: "crypto_major", KXETHPERP: "crypto_major", KXGOLDPERP: "metals", KXSOLPERP: "crypto_major", KXXRPPERP: "crypto_major" };
export async function loadSimData(days: number, markets: Record<string, string> = MARKETS): Promise<SimData[]> {
  const R = perpsReader();
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
  for (const [t, group] of Object.entries(markets)) {
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
  return data;
}
