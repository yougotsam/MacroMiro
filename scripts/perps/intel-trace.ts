/**
 * Live intelligence trace: SOURCE → EVENT → TIMESTAMP → RELEVANCE → SCORE → DECISION (→ OUTCOME later).
 * Builds the real current GOLD/XRP/BTC candidates (signed GETs), with intel OFF (macroClear=false, no intel term) and ON.
 *   bun scripts/perps/intel-trace.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { perpsReader, type PerpCandle } from "../../src/lib/perps/kalshi-perps-read";
import { buildPerpsCandidate, RESEARCH_CLIP_ID } from "../../src/lib/perps/candidates";
import { perpsIntel } from "../../src/lib/perps/intel";
import { rankScore } from "../../src/lib/perps/rank";
import { to15Report } from "../../src/lib/perps/sim";
import { DATA_ROOT } from "../../src/lib/data-root";

const J = (f: string) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; } };
const L = (f: string) => { try { return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const inp = { calendar: J(`${DATA_ROOT}/macro-calendar.json`), intelEvents: L(`${DATA_ROOT}/research/intel-events.jsonl`), mirofish: J(`${DATA_ROOT}/mirofish-latest.json`), spark: J(`${DATA_ROOT}/spark-latest.json`), evidence: L(`${DATA_ROOT}/research/evidence.jsonl`) };
const R = perpsReader(); const fees = await R.feeTiers(); const nowS = Math.floor(Date.now() / 1000);
async function paged(t: string, p: 1 | 60, span: number) { const o: PerpCandle[] = []; const st = p === 1 ? 14400 : 720000; for (let s = nowS - span; s < nowS; s += st) o.push(...(await R.candles(t, p, s, Math.min(nowS, s + st)))); const seen = new Set<number>(); return o.filter((k) => (seen.has(k.t) ? false : (seen.add(k.t), true))).sort((a, b) => a.t - b.t); }
const out: any[] = [];
for (const t of ["KXGOLDPERP", "KXXRPPERP", "KXBTCPERP"]) {
  const requestedAt = Date.now();
  const m1 = await paged(t, 1, 48 * 3600);
  const h1raw = await paged(t, 60, 240 * 3600);
  const [market, book, fund, live] = await Promise.all([R.market(t), R.book(t, 50), R.fundingEstimate(t), R.exchangeStatus()]);
  const receivedMs = Date.now();
  const built = to15Report(m1, receivedMs);
  const h1 = h1raw.filter((k) => k.t + 3_600_000 <= receivedMs);
  const decisionMs = Date.now();
  const intel = perpsIntel(t, decisionMs, inp);
  for (const dir of ["long", "short"] as const) {
    const base = { market, book, b15: built.bars, b1h: h1, dir, makerRate: fees.maker_fee_rates[t], takerRate: fees.taker_fee_rates[t], fundingRate8h: fund.rate, nextFundingMs: fund.nextMs, observedMs: market.markTsMs ?? requestedAt, receivedMs, decisionMs, bookKind: "venue" as const, tradingActive: Boolean(live.trading_active), bookFresh: decisionMs - receivedMs < 15_000, sizingProfile: RESEARCH_CLIP_ID };
    const off = buildPerpsCandidate({ ...base, params: { macroClear: false } });
    const on = buildPerpsCandidate({ ...base, params: { macroClear: intel.macroClear } });
    const rk = (c: typeof off, w: number) => rankScore({ ticker: t, dir, decision: c.decision, winNetUsd: c.payoff.winUsdNet, lossNetUsd: c.payoff.lossUsdNet, riskUsd: c.riskUsd, measuredHitRate: null, evidenceN: 0, spreadPct: c.spreadPct, depthMultiple: 10, stopAtrMultiple: null, intelScore: intel.intelScore, intelWeight: w }).score;
    out.push({ ticker: t, dir, decisionAt: intel.decisionAt, intelOff: { score: off.score, setup: off.setup, aggr7: off.score >= 7 && off.setup !== "NONE", decision: off.decision, rank: rk(off, 0) }, intelOn: { macroClear: intel.macroClear, score: on.score, setup: on.setup, aggr7: on.score >= 7 && on.setup !== "NONE", decision: on.decision, rank: rk(on, intel.weight) }, changed: off.score !== on.score || (off.score >= 7) !== (on.score >= 7) });
  }
  out.push({ ticker: t, intelRows: intel.rows, intelScore: intel.intelScore });
}
const f = `${DATA_ROOT}/perps/intel-trace-${Date.now()}.json`; writeFileSync(f, JSON.stringify(out, null, 1)); console.log(f);
for (const o of out) if (o.intelRows) { console.log(`--- ${o.ticker} intelScore ${o.intelScore}`); for (const r of o.intelRows) console.log(`  ${r.usable} | ${r.source.slice(0, 50)} | ${r.event.slice(0, 60)} | pub ${r.publishedAt} | avail ${r.availableAt} | rel ${r.relevance} | score ${r.score} | ${r.note.slice(0, 90)}`); } else console.log(o.ticker, o.dir, JSON.stringify(o.intelOff), "→", JSON.stringify(o.intelOn), "changed:", o.changed);
