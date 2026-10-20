/**
 * Shared loader for the perps causal replay (used by scripts/perps/sim.ts and scripts/loop/ab-replay.ts).
 * Signed Kalshi GETs only; candles cached under $DATA_ROOT/perps/cache for 3 h. No order paths.
 * Zero and inverted prints are dropped. The full-sample 20% median band is not applied: it uses later prices.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { perpsReader, signedGet, type PerpCandle } from "../../src/lib/perps/kalshi-perps-read";
import type { SimData } from "../../src/lib/perps/sim";
import { DATA_ROOT } from "../../src/lib/data-root";

export const MARKETS: Record<string, string> = { KXBTCPERP: "crypto_major", KXETHPERP: "crypto_major", KXGOLDPERP: "metals", KXSOLPERP: "crypto_major", KXXRPPERP: "crypto_major" };

/** A zero or inverted print is not a price. A full-sample median band is not used here: it looks at the future and deletes later months. */
function saneBars(b: PerpCandle[]) {
  const bars = b.filter((x) => x.o > 0 && x.h > 0 && x.l > 0 && x.c > 0 && x.h >= x.l && [x.o, x.h, x.l, x.c].every(Number.isFinite));
  return { bars, dropped: b.length - bars.length };
}

export async function loadSimData(days: number, markets: Record<string, string> = MARKETS): Promise<SimData[]> {
  const R = perpsReader();
  const nowS = Math.floor(Date.now() / 1000);
  const cacheDir = `${DATA_ROOT}/perps/cache`; mkdirSync(cacheDir, { recursive: true });
  async function candlesOnce(t: string, period: 1 | 60, start: number, end: number) {
    let wait = 500;
    for (let attempt = 0; ; attempt++) {
      try { return await R.candles(t, period, start, end); }
      catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/429|502|503|timeout|aborted/i.test(msg) || attempt >= 8) throw e;
        console.error("candle retry", t, period, attempt, msg);
        await new Promise((r) => setTimeout(r, wait));
        wait = Math.min(wait * 2, 8_000);
      }
    }
  }
  async function paged(t: string, period: 1 | 60, spanS: number) {
    const f = `${cacheDir}/${t}-${period}-${days}d.json`;
    if (existsSync(f) && Date.now() - JSON.parse(readFileSync(f, "utf8")).at < 3 * 3600_000) return JSON.parse(readFileSync(f, "utf8")).bars as PerpCandle[];
    const out: PerpCandle[] = []; const step = period === 1 ? 4 * 3600 : 200 * 3600;
    for (let s = nowS - spanS; s < nowS; s += step) {
      out.push(...(await candlesOnce(t, period, s, Math.min(nowS, s + step))));
      await new Promise((r) => setTimeout(r, 40));
    }
    const seen = new Set<number>(); const bars = out.filter((k) => (seen.has(k.t) ? false : (seen.add(k.t), true))).sort((a, b) => a.t - b.t).filter((k) => k.t + period * 60_000 <= Date.now());
    writeFileSync(f, JSON.stringify({ at: Date.now(), bars })); return bars;
  }
  const [fees, risk] = await Promise.all([R.feeTiers(), signedGet("/risk_parameters") as Promise<any>]);
  const status = JSON.parse(readFileSync(`${DATA_ROOT}/perps/collector-status.json`, "utf8"));
  const data: SimData[] = [];
  for (const [t, group] of Object.entries(markets)) {
    const mk: any = ((await signedGet(`/markets/${t}`)) as any).market;
    const market = (await R.market(t));
    const m1raw = await paged(t, 1, days * 86400 + 16 * 3600); const h1raw = await paged(t, 60, days * 86400 + 240 * 3600);
    const { bars: m1, dropped } = saneBars(m1raw);
    const { bars: h1, dropped: h1dropped } = saneBars(h1raw);
    const fh = await R.fundingHistory(t, nowS - days * 86400 - 86400, nowS);
    const top = status.books?.[t]; const spreadHalf = top?.bestBid && top?.bestAsk ? (top.bestAsk - top.bestBid) / 2 : market.tick;
    data.push({ market, m1, h1, spreadHalf, funding: fh.map((f) => ({ tMs: Date.parse(f.funding_time), rate: Number(f.funding_rate) })), maker: fees.maker_fee_rates[t], taker: fees.taker_fee_rates[t], group,
      spec: { leverage: mk.leverage_estimates, initialMultiplier: Number(risk.initial_margin_multiplier?.[t] ?? 1.3), liqThreshold: Number(risk.liquidation_margin_ratio_threshold ?? 1) } });
    console.error(t, "m1", m1.length, "dropped", dropped, "h1", h1.length, "h1dropped", h1dropped, "funding pts", fh.length, "spreadHalf", spreadHalf, "from", m1[0] ? new Date(m1[0].t).toISOString() : "-", "to", m1.at(-1) ? new Date(m1.at(-1)!.t).toISOString() : "-");
  }
  return data;
}
