/**
 * One real read-only Kalshi perps candidate trace (signed GETs only; no orders exist on this path).
 *   bun scripts/perps/trace.ts [TICKER ...]     → /workspace/data/perps/trace-<ts>.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { perpsReader, priceBand, type PerpCandle } from "../../src/lib/perps/kalshi-perps-read";
import { buildPerpsCandidate } from "../../src/lib/perps/candidates";
import { to15 } from "../../src/lib/perps/sim";
import { DATA_ROOT } from "../../src/lib/data-root";

const R = perpsReader();
const tickers = process.argv.slice(2).length ? process.argv.slice(2) : ["KXBTCPERP", "KXETHPERP", "KXGOLDPERP", "KXSILVERPERP"];
const nowS = Math.floor(Date.now() / 1000);

async function pagedCandles(t: string, period: 1 | 60, spanS: number) {
  const out: PerpCandle[] = [];
  const step = period === 1 ? 4 * 3600 : 200 * 3600;
  for (let s = nowS - spanS; s < nowS; s += step) out.push(...(await R.candles(t, period, s, Math.min(nowS, s + step))));
  const seen = new Set<number>();
  return out.filter((k) => (seen.has(k.t) ? false : (seen.add(k.t), true))).sort((a, b) => a.t - b.t);
}

const [status, fees, enabled] = await Promise.all([R.exchangeStatus(), R.feeTiers(), R.enabled()]);
const report: Record<string, unknown> = { at: new Date().toISOString(), enabled, exchangeStatus: status, ordersPath: "LOCKED OFF (src/lib/perps/order-adapter.ts)", markets: {} };
for (const t of tickers) {
  const observed = Date.now();
  const [market, book, funding] = await Promise.all([R.market(t), R.book(t, 50), R.fundingEstimate(t)]);
  const m1 = await pagedCandles(t, 1, 16 * 3600);
  const h1 = (await pagedCandles(t, 60, 230 * 3600)).filter((k) => k.t + 3_600_000 <= observed);
  const b15 = to15(m1, observed);
  const cands = (["long", "short"] as const).map((dir) => buildPerpsCandidate({ market, book, b15, b1h: h1, dir, makerRate: fees.maker_fee_rates[t], takerRate: fees.taker_fee_rates[t], fundingRate8h: funding.rate, nextFundingMs: funding.nextMs, observedMs: observed }));
  (report.markets as Record<string, unknown>)[t] = { market, bars: { m1: m1.length, b15: b15.length, h1: h1.length }, band: priceBand(book, market.tick), funding, topOfBook: { bids: book.bids.slice(0, 3), asks: book.asks.slice(0, 3) }, candidates: cands };
}
const dir = `${DATA_ROOT}/perps`; mkdirSync(dir, { recursive: true });
const f = `${dir}/trace-${Date.now()}.json`; writeFileSync(f, JSON.stringify(report, null, 1));
console.log(f);
for (const [t, v] of Object.entries(report.markets as Record<string, any>)) for (const c of v.candidates) console.log(t, c.dir, `bars15=${v.bars.b15} h1=${v.bars.h1}`, c.setup, `${c.score}/13`, `entry ${c.entry} stop ${c.stop} T1 ${c.target1} T2 ${c.target2} qty ${c.qtyContracts} notional $${c.notionalUsd}`, `win ${c.payoff.winUsdNet} loss ${c.payoff.lossUsdNet} BE ${c.payoff.breakEvenWinRate}`, `fund ${c.funding.rate8h}`, c.decision, c.reason);
