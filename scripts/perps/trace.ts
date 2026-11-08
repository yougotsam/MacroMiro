/**
 * One real read-only Kalshi perps candidate trace (signed GETs only; no orders exist on this path).
 *   bun scripts/perps/trace.ts [TICKER ...]     → /workspace/data/perps/trace-<ts>.json
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { perpsReader, priceBand, type PerpCandle } from "../../src/lib/perps/kalshi-perps-read";
import { buildPerpsCandidate, RESEARCH_CLIP_ID } from "../../src/lib/perps/candidates";
import { to15Report } from "../../src/lib/perps/sim";
import { bookFreshness } from "../../src/lib/perps/execution";
import { DATA_ROOT } from "../../src/lib/data-root";
import { eligibleMarkets } from "../../src/lib/perps/stream";
import { rankPerpsCandidates } from "../../src/lib/perps/rank";
import { sourcedMacroForPerp } from "../../src/lib/perps/source-evidence";
import type { MacroRelease } from "../../src/lib/perps/intel";
import type { PerpsCandidate } from "../../src/lib/perps/candidates";

const R = perpsReader();
// Discover the real active universe instead of assuming a fixed four-market list.
// Bound historical replay to 8 names by default to control API load.
const requested = process.argv.slice(2);
const liveUniverse = requested.length ? [] : eligibleMarkets(await R.markets());
const tickers = requested.length ? requested : liveUniverse.slice(0, 8);
const nowS = Math.floor(Date.now() / 1000);

async function pagedCandles(t: string, period: 1 | 60, spanS: number) {
  const out: PerpCandle[] = [];
  const step = period === 1 ? 4 * 3600 : 200 * 3600;
  for (let s = nowS - spanS; s < nowS; s += step) out.push(...(await R.candles(t, period, s, Math.min(nowS, s + step))));
  const seen = new Set<number>();
  return out.filter((k) => (seen.has(k.t) ? false : (seen.add(k.t), true))).sort((a, b) => a.t - b.t);
}

const [status, fees, enabled] = await Promise.all([R.exchangeStatus(), R.feeTiers(), R.enabled()]);
const report: Record<string, unknown> = { at: new Date().toISOString(), enabled, exchangeStatus: status, ordersPath: "REVIEW REQUIRED: /api/live/perp-fire blocked on this branch", sizingProfile: RESEARCH_CLIP_ID, markets: {} };
for (const t of tickers) {
  const requestedAt = Date.now();
  const m1 = await pagedCandles(t, 1, 48 * 3600);
  const h1raw = await pagedCandles(t, 60, 230 * 3600);
  const [market, book, funding, liveStatus] = await Promise.all([R.market(t), R.book(t, 50), R.fundingEstimate(t), R.exchangeStatus()]);
  const bookReceivedAt = Date.now();
  const decisionMs = Date.now();
  const fresh = bookFreshness({ fetchedAt: bookReceivedAt, decisionMs, tradingActive: Boolean(liveStatus.trading_active), bestBid: book.bestBid, bestAsk: book.bestAsk });
  const h1 = h1raw.filter((k) => k.t + 3_600_000 <= decisionMs);
  const built = to15Report(m1, decisionMs);
  const cands = (["long", "short"] as const).map((dir) => buildPerpsCandidate({
    market, book, b15: built.bars, b1h: h1, dir, makerRate: fees.maker_fee_rates[t], takerRate: fees.taker_fee_rates[t],
    fundingRate8h: funding.rate, nextFundingMs: funding.nextMs, observedMs: market.markTsMs ?? requestedAt, receivedMs: bookReceivedAt, decisionMs,
    bookKind: "venue", bookFresh: fresh.ok, tradingActive: Boolean(liveStatus.trading_active), sizingProfile: RESEARCH_CLIP_ID,
  }));
  (report.markets as Record<string, unknown>)[t] = {
    market, bars: { m1: m1.length, b15: built.bars.length, incomplete15: built.incomplete.length, h1: h1.length, need15: 60, need1h: 205 },
    book: { fetchedAt: new Date(bookReceivedAt).toISOString(), ageMs: fresh.ageMs, ok: fresh.ok, reasons: fresh.reasons, tradingActive: liveStatus.trading_active },
    band: priceBand(book, market.tick), funding, topOfBook: { bids: book.bids.slice(0, 3), asks: book.asks.slice(0, 3) }, candidates: cands,
  };
}
const macroReleases: MacroRelease[] = (() => {
  try { return readFileSync(`${DATA_ROOT}/research/macro-releases.jsonl`, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as MacroRelease); }
  catch { return []; }
})();
const evidence = Object.fromEntries(tickers.map((t) => [t, sourcedMacroForPerp(t, Date.now(), macroReleases)]));
report.sourceEvidence = Object.fromEntries(Object.entries(evidence).map(([t, rows]) => [t, rows.map((r) => ({ primaryUrl: r.primaryUrl, publishedMs: r.publishedMs, receivedMs: r.receivedMs }))]));
report.ranked = rankPerpsCandidates(
  Object.values(report.markets as Record<string, { candidates: PerpsCandidate[] }>).flatMap((v) => v.candidates),
  evidence,
);
const dir = `${DATA_ROOT}/perps`; mkdirSync(dir, { recursive: true });
const f = `${dir}/trace-${Date.now()}.json`; writeFileSync(f, JSON.stringify(report, null, 1));
console.log(f);
console.log("RESEARCH RANKING (NOT A PROBABILITY OR LIVE ORDER)", JSON.stringify(report.ranked));
for (const [t, v] of Object.entries(report.markets as Record<string, any>)) for (const c of v.candidates) console.log(t, c.dir, `bars15=${v.bars.b15} h1=${v.bars.h1}`, c.setup, `${c.score}/13`, `entry ${c.entry} stop ${c.stop} T1 ${c.target1} T2 ${c.target2} qty ${c.qtyContracts} notional $${c.notionalUsd}`, `win ${c.payoff.winUsdNet} loss ${c.payoff.lossUsdNet} BE ${c.payoff.breakEvenWinRate}`, `fund ${c.funding.rate8h}`, c.decision, c.reason);
