/**
 * Read-only observation collector (round 3, task 3). Runs as its own process (scripts/desk-observe.ts) in its own data
 * dir. It records, for every supported 15-minute market: YES/NO bids and asks with displayed depth (top 10 levels),
 * timestamps, the settlement threshold, the settlement index value (CF Benchmarks RTI / Pyth via Kalshi's websocket,
 * plus Kalshi's official final-minute average when published), the event fee multiplier, the full gate evaluation
 * (every rejected candidate with its exact failed gate, shadow candidates, approval verdict, timing bucket), Coinbase
 * volume/flow indicators, and the final outcome with Kalshi's published expiration value.
 *
 * It cannot place, cancel or amend orders: it never imports oms.ts or the order transport, the process installs a
 * GET-only fetch guard first thing, and observe.test.ts checks both. The websocket only sends subscribe commands.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { MAX_ORDER_COST_USD, MODEL_REV, MODEL_VERSION, REFERENCE, SERIES, type Series } from "./config";
import { Evaluator, decisionRowOf, type SeriesEval } from "./evaluator";
import type { FeeInfo } from "./fees";
import type { Feeds } from "./feeds";
import type { Book, Level } from "./gate";
import type { MoveGuard } from "./guard";
import { availabilitySummary, indicatorReport, TradeTape, type IndicatorReport } from "./indicators";
import type { Market } from "./kalshi-read";
import { RESEARCH_PRODUCT, validateBars, type PublicTrade } from "./market-data";
import { minuteBars } from "./features";
import { evaluateSniper, resampleComplete, type Candle } from "./sniper";
import { reportBucket } from "./approval";
import { etDay } from "./time";

export type RawBook = { orderbook_fp?: { yes_dollars?: [string, string][]; no_dollars?: [string, string][] } };
export type Levels = { yes: Level[]; no: Level[] };

/** Kalshi books are bids-only, ascending; returns best-first levels with positive finite price/size. */
export function parseLevels(raw: RawBook): Levels {
  const side = (arr?: [string, string][]) =>
    (arr ?? []).map(([p, s]) => ({ price: Number(p), size: Number(s) })).filter((l) => l.price > 0 && l.price < 1 && l.size > 0 && Number.isFinite(l.price) && Number.isFinite(l.size)).sort((a, b) => b.price - a.price);
  return { yes: side(raw.orderbook_fp?.yes_dollars), no: side(raw.orderbook_fp?.no_dollars) };
}

/** Executable quote: YES ask = 1 − best NO bid (size = that NO bid's size), and the mirror. */
export function executableQuote(l: Levels) {
  const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
  const yb = l.yes[0] ?? null;
  const nb = l.no[0] ?? null;
  const q = {
    yes_bid: yb?.price ?? null, yes_bid_size: yb?.size ?? null,
    yes_ask: nb ? r4(1 - nb.price) : null, yes_ask_size: nb?.size ?? null,
    no_bid: nb?.price ?? null, no_bid_size: nb?.size ?? null,
    no_ask: yb ? r4(1 - yb.price) : null, no_ask_size: yb?.size ?? null,
  };
  return { ...q, complete: Object.values(q).every((v) => v != null) };
}

export function bookOf(l: Levels, ts: number): Book {
  return { yesBid: l.yes[0] ?? null, noBid: l.no[0] ?? null, ts };
}

export type ObserveDeps = {
  openMarket(series: Series): Promise<Market | null>;
  orderbookRaw(ticker: string): Promise<RawBook>;
  eventFee(series: string, event: string): Promise<FeeInfo>;
  exchangeStatus(): Promise<{ tradingActive: boolean }>;
  marketResult(ticker: string): Promise<{ result: string; value: number | null; status: string } | null>;
  candles(product: string, minutes: 1 | 15 | 60): Promise<Candle[]>;
  trades(product: string): Promise<PublicTrade[]>;
};

type Status = {
  pid: number; startedAt: string; lastTickAt: string | null; ticks: number; rows: number; errors: number; lastError: string | null;
  uniqueTickers: number; completeQuoteTickers: number; outcomes: number; failedGates: Record<string, number>;
  indicators: Record<string, { available: string[]; unavailable: Record<string, string> }>;
  model: string; dataDir: string; network: unknown; feeds: string;
};

export class Collector {
  readonly evaluator: Evaluator;
  private markets = new Map<string, { m: Market | null; at: number }>();
  private fees = new Map<string, { info: FeeInfo | null; at: number }>();
  private ex = { ok: false, at: 0 };
  private seen = new Map<string, { closeMs: number; series: string; complete: boolean; resolved: boolean; lastTry: number }>();
  private tapes = new Map<string, TradeTape>();
  private bars = new Map<string, { m1: Candle[]; m15: Candle[]; h1: Candle[]; at: number }>();
  private lastIndicators = new Map<string, number>();
  private busy = false;
  status: Status;

  constructor(private dir: string, private feeds: Feeds, guard: MoveGuard, private deps: ObserveDeps, private network: () => unknown = () => null) {
    mkdirSync(dir, { recursive: true });
    this.evaluator = new Evaluator(feeds, guard, () => `${dir}/calibrator.json`);
    this.status = { pid: process.pid, startedAt: new Date().toISOString(), lastTickAt: null, ticks: 0, rows: 0, errors: 0, lastError: null, uniqueTickers: 0, completeQuoteTickers: 0, outcomes: 0, failedGates: {}, indicators: {}, model: `${MODEL_VERSION}+${MODEL_REV}`, dataDir: dir, network: null, feeds: "init" };
  }

  private file(kind: string, now: number) {
    return `${this.dir}/${kind}-${etDay(now)}.jsonl`;
  }
  private write(kind: string, row: unknown, now: number) {
    appendFileSync(this.file(kind, now), `${JSON.stringify(row)}\n`);
  }
  private err(where: string, e: unknown) {
    this.status.errors += 1;
    this.status.lastError = `${where}: ${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`;
  }

  private async market(series: Series, now: number) {
    const c = this.markets.get(series);
    if (c && c.m && c.m.closeMs > now && now - c.at < 60_000) return c.m;
    if (c && !c.m && now - c.at < 5_000) return null;
    const m = await this.deps.openMarket(series).catch((e) => (this.err("market", e), null));
    this.markets.set(series, { m, at: now });
    return m;
  }

  private async fee(m: Market | null, now: number) {
    if (!m) return null;
    const c = this.fees.get(m.eventTicker);
    if (c && now - c.at < 60_000) return c.info;
    const info = await this.deps.eventFee(m.series, m.eventTicker).catch((e) => (this.err("fee", e), null));
    this.fees.set(m.eventTicker, { info, at: now });
    return info;
  }

  /** One observation pass over all five series. */
  async tick(now = Date.now()) {
    if (this.busy) return;
    this.busy = true;
    try {
      if (now - this.ex.at > 10_000) {
        const s = await this.deps.exchangeStatus().catch((e) => (this.err("exchange", e), null));
        this.ex = { ok: Boolean(s?.tradingActive), at: s ? now : this.ex.at };
      }
      const exOk = this.ex.ok && now - this.ex.at < 15_000;
      for (const series of SERIES) {
        try {
          const m = await this.market(series, now);
          let levels: Levels | null = null;
          let bookTs = 0;
          if (m) {
            const raw = await this.deps.orderbookRaw(m.ticker).catch((e) => (this.err("book", e), null));
            bookTs = Date.now();
            levels = raw ? parseLevels(raw) : null;
          }
          const fee = await this.fee(m, now);
          const t = Date.now();
          const e = this.evaluator.evaluate(series, m, levels ? bookOf(levels, bookTs) : null, fee, t, exOk, MAX_ORDER_COST_USD);
          this.record(e, levels, fee, t);
        } catch (e) {
          this.err(`series ${series}`, e);
        }
      }
      await this.resolveOutcomes(now);
      this.status.ticks += 1;
      this.status.lastTickAt = new Date().toISOString();
      this.status.network = this.network();
      this.status.feeds = this.feeds.status;
      writeFileSync(`${this.dir}/observe-status.json`, JSON.stringify(this.status, null, 1));
    } finally {
      this.busy = false;
    }
  }

  private record(e: SeriesEval, levels: Levels | null, fee: FeeInfo | null, now: number) {
    const row = decisionRowOf(e, "NO_TRADE", fee, now);
    const q = levels ? executableQuote(levels) : null;
    const ref = REFERENCE[e.series];
    const official = this.feeds.lastOfficialAverage(ref.index);
    const out = {
      ...row,
      kind: "observation",
      event: e.market?.eventTicker ?? null,
      threshold: e.market ? { strike: e.market.strike, type: e.market.strikeType, index: ref.index, dp: ref.dp, kind: ref.kind } : null,
      index: { value: e.spot, age_ms: e.indexAge, official_avg: official ? { value: official.value, window: official.windowSize, t: official.t } : null },
      exec: q,
      levels: levels ? { yes: levels.yes.slice(0, 10), no: levels.no.slice(0, 10) } : null,
      expiry_bucket: e.tte != null ? reportBucket(e.tte) : null,
      rejected: e.failed != null,
    };
    this.write("observations", out, now);
    this.status.rows += 1;
    const g = e.failed ?? "PASS";
    this.status.failedGates[g] = (this.status.failedGates[g] ?? 0) + 1;
    if (e.market) {
      const s = this.seen.get(e.market.ticker) ?? { closeMs: e.market.closeMs, series: e.series, complete: false, resolved: false, lastTry: 0 };
      // complete executable quote = bid and ask with displayed size on BOTH sides, plus a known event fee
      if (q?.complete && fee) s.complete = true;
      this.seen.set(e.market.ticker, s);
      this.status.uniqueTickers = this.seen.size;
      this.status.completeQuoteTickers = [...this.seen.values()].filter((x) => x.complete).length;
    }
  }

  /** After close, poll Kalshi's public market until it publishes the result and expiration value. */
  private async resolveOutcomes(now: number) {
    for (const [ticker, s] of this.seen) {
      if (s.resolved || now < s.closeMs + 20_000 || now - s.lastTry < 30_000) continue;
      s.lastTry = now;
      const r = await this.deps.marketResult(ticker).catch((e) => (this.err("result", e), null));
      if (r && (r.result === "yes" || r.result === "no")) {
        s.resolved = true;
        this.write("outcomes", { ticker, series: s.series, close: new Date(s.closeMs).toISOString(), result: r.result, value: r.value, status: r.status, resolved_at: new Date(now).toISOString() }, now);
        this.status.outcomes += 1;
      }
    }
  }

  /** Coinbase public candles/trades → indicator snapshot per series, once a minute (gold: index bars, no volume). */
  async indicators(now = Date.now()) {
    for (const series of SERIES) {
      if (now - (this.lastIndicators.get(series) ?? 0) < 60_000) continue;
      this.lastIndicators.set(series, now);
      try {
        const product = RESEARCH_PRODUCT[series];
        let report: IndicatorReport;
        let sniper: unknown = null;
        let source: string;
        if (product) {
          const tape = this.tapes.get(product) ?? new TradeTape();
          this.tapes.set(product, tape);
          tape.add(await this.deps.trades(product));
          tape.prune(now - 3 * 3600_000);
          const delta = tape.deltaByMinute();
          const [m1, m15, h1] = await Promise.all([this.deps.candles(product, 1), this.deps.candles(product, 15), this.deps.candles(product, 60)]);
          const v1 = validateBars(m1, 1, now).bars.map((b) => (delta.has(b.t) ? { ...b, delta: delta.get(b.t) } : b));
          const v15 = validateBars(m15, 15, now).bars;
          const v60 = validateBars(h1, 60, now).bars;
          this.bars.set(product, { m1: v1, m15: v15, h1: v60, at: now });
          report = indicatorReport(v1, { volumeSource: `coinbase:${product}`, tradeSide: true });
          sniper = { long: evaluateSniper(v15, v60, "long", true), short: evaluateSniper(v15, v60, "short", true), note: "macro point assumed clear for research scoring only" };
          source = `coinbase:${product} 1m/15m/60m + public trades (${tape.size} on tape)`;
        } else {
          const ref = REFERENCE[series];
          const idx = minuteBars(this.feeds.prints(ref.index, now - 6 * 3600_000), now).map((b) => ({ ...b, t: b.t * 60_000 }));
          report = indicatorReport(idx, { volumeSource: null, tradeSide: false });
          source = `${ref.index} 1-minute index bars (no traded volume)`;
          sniper = { long: evaluateSniper(resampleComplete(idx, 15), resampleComplete(idx, 60), "long", true), short: evaluateSniper(resampleComplete(idx, 15), resampleComplete(idx, 60), "short", true) };
        }
        const summary = availabilitySummary(report);
        this.status.indicators[series] = summary;
        this.write("indicators", { ts: new Date(now).toISOString(), series, source, report, sniper, ...summary }, now);
      } catch (e) {
        this.err(`indicators ${series}`, e);
      }
    }
  }
}
