/**
 * Report-only AURIX-X validation (no orders, no keys, no switches).
 *   bun scripts/desk-validate.ts [--out file.json] [--persist] [--offline]
 * 1. Probability validation on the desk's own ledger (decisions.jsonl + outcomes.jsonl), read-only, one report per
 *    model version. Each event's actual fee multiplier is read from Kalshi's PUBLIC /series and /events endpoints
 *    (unauthenticated GET; skipped with --offline, then fee-unknown rows are not booked).
 * 2. Research market data from PUBLIC Coinbase endpoints: 15m/1h OHLCV checks, EMA200 warm-up, signed flow.
 *    --persist appends complete bars to <desk data>/bars; without it nothing is written there.
 */
import { createReadStream, existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { SERIES, dataDir } from "../src/lib/desk/config";
import { eventOf, joinObservations, validate, type LedgerRow, type OutcomeRow } from "../src/lib/desk/calibration";
import { eventFee } from "../src/lib/desk/kalshi-read";
import { BarStore, RESEARCH_PRODUCT, attachDelta, fetchPublicCandles, fetchPublicTrades, validateBars, warmupReady, type Interval } from "../src/lib/desk/market-data";

const args = process.argv.slice(2);
const outAt = args.indexOf("--out");
const OUT = outAt >= 0 ? args[outAt + 1] : null;
const PERSIST = args.includes("--persist");
const OFFLINE = args.includes("--offline");
const dir = dataDir();

async function readJsonl<T>(file: string, keep: (line: string) => boolean): Promise<T[]> {
  const out: T[] = [];
  if (!existsSync(file)) return out;
  const rl = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const l of rl) {
    if (!l.trim() || !keep(l)) continue;
    try {
      out.push(JSON.parse(l) as T);
    } catch {
      /* skip torn line */
    }
  }
  return out;
}

const decisions = await readJsonl<LedgerRow>(`${dir}/decisions.jsonl`, (l) => l.includes('"quotes":{'));
const outcomes = await readJsonl<OutcomeRow>(`${dir}/outcomes.jsonl`, () => true);
const fees = new Map<string, number>();
const feeErrors: string[] = [];
if (!OFFLINE) {
  const events = [...new Set(outcomes.map((o) => eventOf(o.ticker)))].sort();
  for (const ev of events) {
    try {
      const f = await eventFee(ev.split("-")[0], ev);
      fees.set(ev, f.multiplier);
    } catch (e) {
      feeErrors.push(`${ev}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await new Promise((r) => setTimeout(r, 60));
  }
}
const obs = joinObservations(decisions, outcomes, undefined, fees);
const probability = {
  source: {
    decisions: decisions.length,
    outcomes: outcomes.length,
    models: [...new Set(decisions.map((d) => d.model))],
    eventFees: { fetched: fees.size, failed: feeErrors.length, multipliers: [...new Set(fees.values())], errors: feeErrors.slice(0, 5) },
    rowsWithDepth: decisions.filter((d) => d.depth != null).length,
  },
  byModel: validate(obs),
};

const marketData: Record<string, unknown> = {};
if (!OFFLINE) {
  const store = PERSIST ? new BarStore() : null;
  for (const s of SERIES) {
    const product = RESEARCH_PRODUCT[s];
    if (!product) {
      marketData[s] = { supported: false, why: "no public spot-exchange volume source; not proxied" };
      continue;
    }
    const now = Date.now();
    const row: Record<string, unknown> = { product };
    try {
      // enough history to cover at least two full 15-minute bars of signed flow
      const trades = await fetchPublicTrades(product, undefined, now - 45 * 60_000, 20);
      for (const m of [15, 60] as Interval[]) {
        const chk = validateBars(await fetchPublicCandles(product, m), m, now);
        const withFlow = attachDelta(chk.bars, trades, m);
        const added = store ? store.merge(product, m, chk.bars, now) : 0;
        row[`${m}m`] = {
          bars: chk.bars.length, forming: chk.forming, dropped: chk.dropped, gaps: chk.gaps.length, problems: chk.problems,
          ema200: warmupReady(chk.bars, m, now), barsWithSignedFlow: withFlow.filter((b) => b.delta !== undefined).length,
          persisted: added,
        };
      }
      row.trades = trades.length;
    } catch (e) {
      row.error = e instanceof Error ? e.message : String(e);
    }
    marketData[s] = row;
  }
}

const report = { ts: new Date().toISOString(), probability, marketData, note: "report-only; CALIBRATED_MODEL_APPROVED is not read or changed here" };
const text = JSON.stringify(report, null, 1);
if (OUT) writeFileSync(OUT, text);
console.log(text);
