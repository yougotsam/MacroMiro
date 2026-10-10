/**
 * Intelligence-event trace (generic). Evaluates every event in <DATA_ROOT>/research/intel-events*.jsonl against the
 * first real scan of the matching market AFTER publication and the first AFTER our detection, using the reusable
 * evaluator (src/lib/paper/intel-events.ts). Information is never marked available before we detected it, and
 * "priced in" is reported only from quotes. 0 credits.   bun scripts/grid/trace.ts
 */
import { writeFileSync } from "node:fs";
import { DATA_ROOT } from "../../src/lib/data-root";
import { dayFiles, readJsonlFiles } from "../../src/lib/paper/files";
import { evaluateEvent, seriesFor, type IntelEvent, type QuotePoint } from "../../src/lib/paper/intel-events";

type Obs = { ts: string; ticker: string; series: string; close: string; tte_s: number; exec: { yes_bid: number | null; yes_ask: number | null } | null; failed_gate: string | null };
const obs = readJsonlFiles<Obs>(dayFiles(`${DATA_ROOT}/desk-observe`, "observations-"), (l) => l.includes('"exec":{')).filter((o) => o.exec?.yes_ask != null && o.exec?.yes_bid != null).sort((a, b) => a.ts.localeCompare(b.ts));
const quotes: QuotePoint[] = obs.map((o) => ({ ts: o.ts, series: o.series, mid: (o.exec!.yes_bid! + o.exec!.yes_ask!) / 2 }));
const events = readJsonlFiles<IntelEvent>(dayFiles(`${DATA_ROOT}/research`, "intel-events"));
const firstAfter = (series: string[], t: number) => obs.find((o) => series.includes(o.series) && Date.parse(o.ts) >= t) ?? null;

const traces = events.map((e) => {
  const series = e.assets.map(seriesFor).filter(Boolean) as string[];
  const atPub = e.publishedAt ? firstAfter(series, Date.parse(e.publishedAt)) : null;
  const atDet = firstAfter(series, Date.parse(e.detectedAt));
  const view = (o: Obs | null) => (o ? { scan: o.ts, ticker: o.ticker, tteSec: o.tte_s, yesBid: o.exec!.yes_bid, yesAsk: o.exec!.yes_ask, deskGate: o.failed_gate, eval: evaluateEvent(e, o.ts, quotes) } : "no quoted scan for this market after this time");
  return { event: e, firstScanAfterPublication: view(atPub), firstScanAfterDetection: view(atDet),
    decisionChange: e.direction ? "directional event: see paper C config" : "no direction → cannot change any decision (weight 0)" };
});
writeFileSync(`${DATA_ROOT}/research/grid-trace.json`, JSON.stringify({ builtAt: new Date().toISOString(), traces }, null, 1));
console.log(JSON.stringify(traces, null, 1));
