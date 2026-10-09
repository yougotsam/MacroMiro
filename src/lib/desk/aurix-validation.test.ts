import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALIBRATED_MODEL_APPROVED } from "./config";
import { quadraticFee } from "./fees";
import { brier, fitRecalibration, joinObservations, purgedSplit, takerReplay, validate, verdict, type Obs } from "./calibration";
import { officialMatches } from "./feeds";
import { buildSnapshot, orderOutcomeSide, sidePrice, type KOrder } from "./kalshi-read";
import { macroVeto, scheduledVeto } from "./macro-calendar";
import { BarStore, attachDelta, fetchPublicCandles, fetchPublicTrades, parseCoinbaseCandles, signedDeltaByBar, validateBars, warmupReady } from "./market-data";
import { Oms, cidFor } from "./oms";
import { RiskEngine } from "./risk";
import { restingOf } from "./engine";
import type { Candle } from "./sniper";

const tmp = (p: string) => mkdtempSync(join(tmpdir(), `aurix-${p}-`));
const T = "KXBTC15M-26OCT081200-00";

describe("review B1: pending order risk clears once Kalshi acknowledged the order", () => {
  const rows = (cid: string, stages: string[], ts: string) =>
    stages.map((stage) => JSON.stringify({ ts, cid, stage, ticker: T, worst: 1.5, orderId: stage === "intent" ? undefined : "oid" })).join("\n");
  it("sent / found / cancelled orders from earlier days are not pending; ambiguous ones still are", () => {
    const dir = tmp("b1");
    const old = "2026-10-07T12:00:00.000Z";
    const j = [
      rows(cidFor(T, "yes", 1), ["intent", "sent"], old),
      rows(cidFor(T, "yes", 2), ["intent", "unknown", "found"], old),
      rows(cidFor(T, "yes", 3), ["intent", "sent", "cancel"], old),
      rows(cidFor(T, "no", 1), ["intent", "rejected"], old),
      rows(cidFor(T, "no", 2), ["intent", "unknown"], old), // never resolved → still pending, fail closed
      rows(cidFor(T, "no", 3), ["intent"], old),
    ].join("\n");
    writeFileSync(join(dir, "oms-journal.jsonl"), j + "\n");
    const oms = new Oms(new RiskEngine(dir), async () => ({ status: 500, body: {}, text: "" }), async () => [], dir);
    const p = oms.pendingIntents(Date.parse("2026-10-09T12:00:00Z"));
    expect(p.map((x) => x.cid).sort()).toEqual([cidFor(T, "no", 2), cidFor(T, "no", 3)].sort());
    expect(oms.pendingWorst()).toBeCloseTo(3, 6);
    // the snapshot therefore carries only the ambiguous $3, not every order the desk ever sent
    const s = buildSnapshot({ now: Date.parse("2026-10-09T12:00:00Z"), settlements: [], positions: [], resting: [], ordersToday: [], shard2Cash: 10, exchangeTradingActive: true, exchangeCheckedAt: Date.parse("2026-10-09T12:00:00Z"), pendingIntents: p });
    expect(s.pendingWorst).toBeCloseTo(3, 6);
  });
});

describe("review B2: NO orders are read as NO in the resting-order guard", () => {
  const base = { order_id: "o1", ticker: T, client_order_id: "mm1-x", status: "resting", yes_price_dollars: "0.3000", no_price_dollars: "0.7000", remaining_count_fp: "2.00" } as KOrder;
  it("V2 'ask' is a NO bid and 'bid' is a YES bid; explicit outcome_side wins", () => {
    expect(orderOutcomeSide({ ...base, side: "ask" })).toBe("no");
    expect(orderOutcomeSide({ ...base, side: "bid" })).toBe("yes");
    expect(orderOutcomeSide({ ...base, side: "ask", outcome_side: "yes" })).toBe("yes");
    expect(restingOf({ ...base, side: "ask" })).toMatchObject({ side: "no", price: 0.7 });
    expect(restingOf({ ...base, side: "bid" })).toMatchObject({ side: "yes", price: 0.3 });
    expect(sidePrice({ ...base, side: "ask" })).toBe(0.7);
  });
  it("an unreadable side is never guessed (null → the engine pulls it)", () => {
    expect(orderOutcomeSide({ ...base, side: "sideways" })).toBeNull();
    expect(restingOf({ ...base, side: "sideways" })).toBeNull();
    expect(restingOf({ ...base, side: "ask", no_price_dollars: "abc" })).toBeNull();
  });
});

describe("review B3: the official 60 s accumulator matches at second resolution", () => {
  const close = Date.parse("2026-10-08T12:00:00Z");
  it("a raw millisecond accumulator time matches the floored print second", () => {
    const lastT = close - 20_000; // floored print at 11:59:40
    expect(officialMatches({ t: lastT + 437, windowSize: 40 }, lastT, close)).toBe(true);
    expect(officialMatches({ t: lastT, windowSize: 40 }, lastT, close)).toBe(true);
  });
  it("a different second, a wrong count, or a missing accumulator still fails closed", () => {
    const lastT = close - 20_000;
    expect(officialMatches({ t: lastT + 1_000, windowSize: 40 }, lastT, close)).toBe(false);
    expect(officialMatches({ t: lastT - 1, windowSize: 40 }, lastT, close)).toBe(false);
    expect(officialMatches({ t: lastT + 5, windowSize: 39 }, lastT, close)).toBe(false);
    expect(officialMatches(null, lastT, close)).toBe(false);
    expect(officialMatches({ t: close, windowSize: 60 }, close, close)).toBe(true);
  });
});

describe("macro calendar veto (order path reads only the calendar)", () => {
  it("blocks around explicitly timed CPI/FOMC only", () => {
    const now = Date.parse("2026-10-09T12:10:00Z");
    expect(scheduledVeto([{ name: "CPI", when: "2026-10-09T12:30:00Z" }], now)).toHaveLength(1);
    expect(scheduledVeto([{ name: "CPI", when: "Friday 8:30" }], now)).toHaveLength(0);
    expect(scheduledVeto([{ name: "Retail earnings", when: "2026-10-09T12:30:00Z" }], now)).toHaveLength(0);
    const dir = tmp("cal");
    writeFileSync(join(dir, "desk-news.json"), JSON.stringify({ calendar: { thisWeek: [{ name: "FOMC rate decision", when: "2026-10-09T12:00:00Z" }] }, headlines: ["ignored"] }));
    expect(macroVeto(now, join(dir, "desk-news.json"))).toHaveLength(1);
    expect(macroVeto(now, join(dir, "missing.json"))).toEqual([]);
  });
});

describe("research market data (public, read-only)", () => {
  const NOW = Date.parse("2026-10-09T09:20:00Z");
  const bar = (t: number, c = 100, v = 5): Candle => ({ t, o: c, h: c + 1, l: c - 1, c, v });
  const q = 15 * 60_000;
  it("parses Coinbase rows and keeps only complete, sane, on-grid bars; gaps reported, not filled", () => {
    const rows = [[(NOW - q) / 1000 - ((NOW - q) / 1000) % 900, 99, 101, 100, 100.5, 3]];
    expect(parseCoinbaseCandles(rows)[0]).toMatchObject({ o: 100, h: 101, l: 99, c: 100.5, v: 3 });
    const start = Date.parse("2026-10-09T08:00:00Z");
    const input = [bar(start), bar(start + q), bar(start + 3 * q), bar(start + 4 * q), { ...bar(start + 2 * q), h: 50 }, bar(start + 5 * q), bar(start + 7 * q)];
    const chk = validateBars(input, 15, NOW);
    expect(chk.forming).toBe(2); // 09:15 bar still forming at 09:20 and a future 09:45 bar → never used (no repaint)
    expect(chk.dropped).toBe(1); // high below close
    expect(chk.gaps.length).toBe(1);
    expect(chk.ok).toBe(false);
    expect(chk.bars.map((b) => b.t)).toEqual([start, start + q, start + 3 * q, start + 4 * q]);
  });
  it("EMA200 warm-up needs 200 contiguous bars ending at the latest complete bar", () => {
    const end = Date.parse("2026-10-09T09:00:00Z");
    const bars = Array.from({ length: 210 }, (_, i) => bar(end - (209 - i) * q));
    expect(warmupReady(bars, 15, NOW).ready).toBe(true);
    const holed = bars.filter((_, i) => i !== 100);
    expect(warmupReady(holed, 15, NOW)).toMatchObject({ ready: false, have: 109 });
    expect(warmupReady(bars, 15, NOW + 2 * q).ready).toBe(false); // stale
  });
  it("signed flow: Coinbase side is the maker side, so maker 'sell' = aggressive buy", () => {
    const t0 = Date.parse("2026-10-09T08:00:00Z");
    const tr = (min: number, side: string, size: string, id: number) => ({ trade_id: id, side, size, price: "1", time: new Date(t0 + min * 60_000).toISOString() });
    const trades = [tr(1, "sell", "2", 1), tr(2, "buy", "0.5", 2), tr(16, "sell", "1", 3), tr(31, "buy", "1", 4), tr(47, "buy", "3", 5)];
    const d = signedDeltaByBar(trades, 15);
    expect(d.get(t0)).toBeCloseTo(1.5, 9);
    const bars = [0, 1, 2, 3].map((k) => bar(t0 + k * q));
    const withFlow = attachDelta(bars, trades, 15);
    expect(withFlow[0].delta).toBeUndefined(); // bar holding the oldest trade may be partial
    expect(withFlow[1].delta).toBeCloseTo(1, 9);
    expect(withFlow[2].delta).toBeCloseTo(-1, 9);
    expect(withFlow[3].delta).toBeUndefined(); // not fully covered by the sample
  });
  it("fetchers only GET the public host and page back with the after cursor", async () => {
    const urls: string[] = [];
    const get = async (u: string) => {
      urls.push(u);
      if (u.includes("/candles")) return [[1791536400, 1, 2, 1.5, 1.6, 9]];
      return u.includes("after=") ? [{ trade_id: 5, side: "buy", size: "1", price: "1", time: "2026-10-09T08:00:00Z" }] : [{ trade_id: 9, side: "sell", size: "1", price: "1", time: "2026-10-09T09:00:00Z" }];
    };
    expect((await fetchPublicCandles("BTC-USD", 60, get)).length).toBe(1);
    const t = await fetchPublicTrades("BTC-USD", get, Date.parse("2026-10-09T08:30:00Z"), 5, 0);
    expect(t.map((x) => x.trade_id)).toEqual([9, 5]);
    expect(urls.every((u) => u.startsWith("https://api.exchange.coinbase.com/products/"))).toBe(true);
    expect(urls[2]).toContain("after=9");
    await expect(fetchPublicCandles("BTC-USD/../orders", 15, get)).rejects.toThrow();
  });
  it("bar store persists complete bars once and re-validates on read", () => {
    const store = new BarStore(tmp("bars"));
    const start = Date.parse("2026-10-09T08:00:00Z");
    expect(store.merge("BTC-USD", 15, [bar(start), bar(start + q), bar(start + 5 * q)], NOW)).toBe(2);
    expect(store.merge("BTC-USD", 15, [bar(start), bar(start + q), bar(start + 2 * q)], NOW)).toBe(1);
    expect(store.read("BTC-USD", 15, NOW).bars.length).toBe(3);
  });
});

describe("probability validation (report-only)", () => {
  const mk = (i: number, p: number, y: 0 | 1, bid = 0.45, ask = 0.47): Obs => ({
    ticker: `KXBTC15M-X${i}`, series: "KXBTC15M", closeMs: Date.parse("2026-10-08T00:00:00Z") + i * 15 * 60_000, tteBucket: 120, tte: 118, p, pBase: p, yesBid: bid, yesAsk: ask, mid: (bid + ask) / 2, y,
  });
  it("joins one observation per contract per time bucket and drops rows without real quotes or outcomes", () => {
    const row = (tte: number, p: number, quotes: Record<string, number | null> | null, ticker = T) => ({ ts: "", ticker, close: "2026-10-08T16:00:00Z", tte_s: tte, p, p_base: p, quotes });
    const q = { yes_bid: 0.4, yes_ask: 0.42 };
    const obs = joinObservations(
      [row(130, 0.5, q), row(119, 0.6, q), row(300, 0.7, q), row(200, 0.8, q), row(45, 0.9, null), row(45, 0.9, { yes_bid: 0.5, yes_ask: 0.4 }), row(120, 0.5, q, "KXETH15M-NOOUTCOME")],
      [{ ticker: T, result: "yes" }],
    );
    expect(obs.map((o) => [o.tteBucket, o.p])).toEqual([[300, 0.7], [120, 0.6]]);
    expect(obs[0].y).toBe(1);
  });
  it("the temporal split keeps every test contract after the purge gap and none on both sides", () => {
    const obs = Array.from({ length: 40 }, (_, i) => mk(i, 0.5, (i % 2) as 0 | 1));
    const { train, test, cut } = purgedSplit(obs, 0.5, 30 * 60_000);
    expect(cut).not.toBeNull();
    expect(Math.max(...train.map((o) => o.closeMs))).toBeLessThan(cut! - 30 * 60_000);
    expect(Math.min(...test.map((o) => o.closeMs))).toBeGreaterThanOrEqual(cut!);
    const both = train.filter((o) => test.some((x) => x.ticker === o.ticker));
    expect(both).toEqual([]);
    expect(train.length + test.length).toBe(38); // two contracts purged
  });
  it("recalibration recovers a known over-confident forecast and lowers Brier", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const truth: number[] = [], ys: number[] = [], over: number[] = [];
    for (let i = 0; i < 4000; i += 1) {
      const z = (rnd() - 0.5) * 4;
      const p = 1 / (1 + Math.exp(-z));
      truth.push(p);
      ys.push(rnd() < p ? 1 : 0);
      over.push(1 / (1 + Math.exp(-2 * z)));
    }
    const fit = fitRecalibration(over, ys);
    expect(fit.a).toBeGreaterThan(0.4);
    expect(fit.a).toBeLessThan(0.6);
    expect(brier(over.map(fit.apply), ys)).toBeLessThan(brier(over, ys));
  });
  it("taker replay pays the ask plus the real quadratic fee and respects the 4¢ minimum", () => {
    const fee = quadraticFee(1, 0.47);
    const r = takerReplay([mk(1, 0.6, 1), mk(2, 0.6, 0), mk(3, 0.5, 1)], (o) => o.p);
    expect(r.trades).toBe(2); // p 0.5 has no edge
    expect(r.total).toBeCloseTo(1 - 2 * (0.47 + fee), 4);
  });
  it("the verdict is advisory only and the release gate stays off", () => {
    const obs = Array.from({ length: 60 }, (_, i) => mk(i, 0.9, 1, 0.88, 0.9));
    const rep = validate(obs);
    expect(rep.verdict.worthHumanReview).toBe(false);
    expect(rep.verdict.releaseGateUnchanged).toBe(true);
    expect(verdict({ contracts: { test: 900 }, test: { model: { brier: 0.1 }, marketMid: { brier: 0.2 } }, afterCostTaker: { model: { trades: 300, mean: 0.05, se: 0.01 } } }).worthHumanReview).toBe(true);
    expect(CALIBRATED_MODEL_APPROVED).toBe(false);
  });
});
