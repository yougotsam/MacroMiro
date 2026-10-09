import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CALIBRATED_MODEL_APPROVED, PRICE_MIN } from "./config";
import { cryptoProb } from "./settlement";
import { quadraticFee } from "./fees";
import { brier, clusteredSe, fitRecalibration, joinObservations, purgedSplit, takerReplay, validate, verdict, type Obs } from "./calibration";
import { officialMatches } from "./feeds";
import { buildSnapshot, orderOutcomeSide, sidePrice, type KOrder } from "./kalshi-read";
import { CALENDAR_MAX_AGE_MS, macroGate, macroGateFrom, scheduledVeto } from "./macro-calendar";
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

describe("macro calendar gate (Codex P2: FAIL-CLOSED; order path reads only the calendar)", () => {
  const now = Date.parse("2026-10-09T12:10:00Z");
  const fresh = 3600_000;
  it("blocks around explicitly timed CPI/FOMC only", () => {
    expect(scheduledVeto([{ name: "CPI", when: "2026-10-09T12:30:00Z" }], now)).toHaveLength(1);
    expect(scheduledVeto([{ name: "CPI", when: "Friday 8:30" }], now)).toHaveLength(0);
    expect(scheduledVeto([{ name: "Retail earnings", when: "2026-10-09T12:30:00Z" }], now)).toHaveLength(0);
    const g = macroGateFrom({ calendar: { thisWeek: [{ name: "FOMC rate decision", when: "2026-10-09T12:00:00Z" }] }, headlines: ["ignored"] }, now, fresh);
    expect(g).toMatchObject({ available: true, blocked: true, reason: "verified_macro_event_veto" });
    const clear = macroGateFrom({ calendar: { thisWeek: [{ name: "FOMC rate decision", when: "2026-10-10T18:00:00Z" }], nextWeek: [] } }, now, fresh);
    expect(clear).toMatchObject({ available: true, blocked: false, reason: null });
  });
  it("missing, unreadable, malformed or stale calendar BLOCKS entries (unknown ≠ clear)", () => {
    const dir = tmp("cal");
    expect(macroGate(Date.now(), join(dir, "missing.json"))).toMatchObject({ available: false, blocked: true, reason: "macro_calendar_unavailable" });
    writeFileSync(join(dir, "bad.json"), "{not json");
    expect(macroGate(Date.now(), join(dir, "bad.json"))).toMatchObject({ available: false, blocked: true });
    writeFileSync(join(dir, "nocal.json"), JSON.stringify({ headlines: [] }));
    expect(macroGate(Date.now(), join(dir, "nocal.json")).reason).toBe("macro_calendar_malformed");
    writeFileSync(join(dir, "ok.json"), JSON.stringify({ calendar: { thisWeek: [], nextWeek: [] } }));
    expect(macroGate(Date.now(), join(dir, "ok.json"))).toMatchObject({ available: true, blocked: false });
    expect(macroGateFrom({ calendar: { thisWeek: [] } }, now, CALENDAR_MAX_AGE_MS + 1).reason).toBe("macro_calendar_stale");
    expect(macroGateFrom({ calendar: { thisWeek: [] } }, now, null).blocked).toBe(true);
  });
  it("a major release with no timezone blocks its whole ET day; an undated one makes the calendar unusable", () => {
    const sameDay = macroGateFrom({ calendar: { thisWeek: [{ name: "US Non-Farm Employment Change", when: "2026-10-09 7:30am" }] } }, now, fresh);
    expect(sameDay.blocked).toBe(true);
    expect(sameDay.events[0]).toContain("whole ET day");
    expect(macroGateFrom({ calendar: { thisWeek: [{ name: "US CPI m/m", when: "2026-10-12 7:30am" }] } }, now, fresh).blocked).toBe(false);
    expect(macroGateFrom({ calendar: { thisWeek: [{ name: "US CPI m/m", when: "soon" }] } }, now, fresh)).toMatchObject({ available: false, blocked: true });
  });
  it("engine source enforces the gate after pricing and keeps the would-be trade as shadow only", () => {
    const src = readFileSync(new URL("./engine.ts", import.meta.url), "utf8") as string;
    expect(src).toContain("if (macro.blocked) {");
    expect(src).toMatch(/macro\.available && !macro\.blocked/);
    expect(src).not.toMatch(/firecrawl|mirofish|spark\.server/i);
  });
});

describe("Codex P1: settlement accumulator timestamps compared at second resolution", () => {
  it("cryptoProb accepts a +437 ms official timestamp for the floored print second, rejects another second", () => {
    const closeMs = Date.parse("2026-10-08T12:00:00Z");
    const lastT = closeMs - 20_000;
    const windowPrints = new Map<number, number>();
    for (let s = closeMs - 59_000; s <= lastT; s += 1000) windowPrints.set(s, 100);
    const base = { closeMs, strike: 99.5, dp: 2, last: { t: lastT, v: 100 }, windowPrints, sigma: 1e-4 };
    expect(() => cryptoProb({ ...base, official: { value: 100, count: 40, t: lastT + 437 } })).not.toThrow();
    expect(() => cryptoProb({ ...base, official: { value: 100, count: 40, t: lastT + 1000 } })).toThrow();
    expect(() => cryptoProb({ ...base, official: { value: 100, count: 39, t: lastT + 437 } })).toThrow();
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
  const close0 = Date.parse("2026-10-08T00:00:00Z");
  const mk = (i: number, p: number, y: 0 | 1, over: Partial<Obs> = {}): Obs => ({
    ticker: `KXBTC15M-X${i}`, series: "KXBTC15M", model: "m1", closeMs: close0 + i * 15 * 60_000, tteBucket: 120, tte: 118, p, pBase: p,
    yesBid: 0.45, yesAsk: 0.47, mid: 0.46, y, yesBidSize: 50, noBidSize: 50, feeMultiplier: 1, ...over,
  });
  it("joins one observation per model, contract and bucket; keeps recorded depth and fee; drops rows without real quotes or outcomes", () => {
    const row = (tte: number, p: number, quotes: Record<string, number | null> | null, extra: Record<string, unknown> = {}, ticker = T) => ({ ts: "", ticker, close: "2026-10-08T16:00:00Z", tte_s: tte, p, p_base: p, quotes, model: "m1", ...extra });
    const q = { yes_bid: 0.4, no_bid: 0.58 };
    const obs = joinObservations(
      [row(130, 0.5, q), row(119, 0.6, q, { depth: { yes_bid_size: 12, no_bid_size: 3 }, fee_multiplier: 0.5 }), row(300, 0.7, q), row(200, 0.8, q), row(45, 0.9, null), row(45, 0.9, { yes_bid: 0.5, no_bid: 0.6 }), row(120, 0.5, q, {}, "KXETH15M-NOOUTCOME"), row(120, 0.55, q, { model: "m2" })],
      [{ ticker: T, result: "yes" }],
      undefined,
      new Map([["KXBTC15M-26OCT081200", 1]]),
    );
    expect(obs.map((o) => [o.model, o.tteBucket, o.p])).toEqual([["m1", 300, 0.7], ["m1", 120, 0.6], ["m2", 120, 0.55]]);
    expect(obs[1]).toMatchObject({ yesAsk: 0.42, yesBidSize: 12, noBidSize: 3, feeMultiplier: 0.5, y: 1 });
    expect(obs[0]).toMatchObject({ yesBidSize: null, feeMultiplier: 1 });
  });
  it("Codex P1 model-version isolation: every model gets its own report and verdict; versions are never pooled", () => {
    const a = Array.from({ length: 40 }, (_, i) => mk(i, 0.9, 1));
    const b = Array.from({ length: 40 }, (_, i) => mk(i, 0.1, 1, { model: "m2" }));
    const r = validate([...a, ...b]);
    expect(Object.keys(r)).toEqual(["m1", "m2"]);
    expect(r.m1.observations.all).toBe(40);
    expect(r.m2.observations.all).toBe(40);
    expect(r.m1.test.model!.brier).toBeLessThan(r.m2.test.model!.brier);
  });
  it("the temporal split keeps every test contract after the purge gap and none on both sides", () => {
    const obs = Array.from({ length: 40 }, (_, i) => mk(i, 0.5, (i % 2) as 0 | 1));
    const { train, test, cut } = purgedSplit(obs, 0.5, 30 * 60_000);
    expect(cut).not.toBeNull();
    expect(Math.max(...train.map((o) => o.closeMs))).toBeLessThan(cut! - 30 * 60_000);
    expect(Math.min(...test.map((o) => o.closeMs))).toBeGreaterThanOrEqual(cut!);
    expect(train.filter((o) => test.some((x) => x.ticker === o.ticker))).toEqual([]);
    expect(train.length + test.length).toBe(38);
  });
  it("recalibration recovers a known over-confident forecast and lowers Brier", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const ys: number[] = [], over: number[] = [];
    for (let i = 0; i < 4000; i += 1) {
      const z = (rnd() - 0.5) * 4;
      ys.push(rnd() < 1 / (1 + Math.exp(-z)) ? 1 : 0);
      over.push(1 / (1 + Math.exp(-2 * z)));
    }
    const fit = fitRecalibration(over, ys);
    expect(fit.a).toBeGreaterThan(0.4);
    expect(fit.a).toBeLessThan(0.6);
    expect(brier(over.map(fit.apply), ys)).toBeLessThan(brier(over, ys));
  });
  it("Codex P1 actual fee: the event's multiplier is charged (and changes eligibility); unknown fee is never booked", () => {
    const o = mk(1, 0.55, 1, { yesBid: 0.4, yesAsk: 0.47 });
    const cheap = takerReplay([o], (x) => x.p);
    const dear = takerReplay([{ ...o, feeMultiplier: 3 }], (x) => x.p);
    expect(cheap.trades).toBe(1);
    expect(dear.trades).toBe(0); // 3× fee kills the 4¢ edge
    expect(dear.skipped.gate).toBe(1);
    expect(takerReplay([{ ...o, feeMultiplier: null }], (x) => x.p).skipped.feeUnknown).toBe(1);
    const n = Math.floor(3 / 0.47);
    let k = n;
    while (k > 0 && k * 0.47 + quadraticFee(k, 0.47, 1) > 3 + 1e-9) k -= 1;
    expect(cheap.total).toBeCloseTo(k * (1 - 0.47) - quadraticFee(k, 0.47, 1), 4);
  });
  it("Codex P2 depth: fills only against displayed size; no recorded depth → not booked", () => {
    const o = mk(1, 0.55, 1, { yesBid: 0.4, yesAsk: 0.47 });
    expect(takerReplay([{ ...o, noBidSize: 2 }], (x) => x.p).total).toBeCloseTo(2 * 0.53 - quadraticFee(2, 0.47, 1), 4);
    expect(takerReplay([{ ...o, noBidSize: 0.6 }], (x) => x.p).trades).toBe(0); // under one contract displayed
    expect(takerReplay([{ ...o, noBidSize: null }], (x) => x.p).skipped.depthUnknown).toBe(1);
  });
  it("Codex P1 price bands: asks under 4¢, over 93¢, or under 5¢ in the last minute are never booked", () => {
    const low = mk(1, 0.2, 1, { yesBid: 0.02, yesAsk: 0.035, tte: 300 });
    expect(PRICE_MIN).toBeGreaterThan(0.035);
    expect(takerReplay([low], (x) => x.p).trades).toBe(0);
    const lastMin = mk(2, 0.2, 1, { yesBid: 0.03, yesAsk: 0.045, tte: 40 });
    expect(takerReplay([lastMin], (x) => x.p).trades).toBe(0);
    expect(takerReplay([{ ...lastMin, tte: 300 }], (x) => x.p).trades).toBe(1); // same quote, 5 min out: inside the band
    const high = mk(3, 0.999, 1, { yesBid: 0.94, yesAsk: 0.95 });
    expect(takerReplay([high], (x) => x.p).trades).toBe(0);
  });
  it("Codex P1 clustering: one entry per contract, and SE clustered by close window is not smaller than pretending independence", () => {
    const sameContract = [mk(1, 0.6, 1, { tte: 600, tteBucket: 600 }), mk(1, 0.6, 1, { tte: 300, tteBucket: 300 }), mk(1, 0.6, 1)];
    const r = takerReplay(sameContract, (x) => x.p);
    expect(r.trades).toBe(1);
    expect(r.skipped.alreadyEntered).toBe(2);
    // 4 coins per window, outcomes perfectly shared inside a window
    const rows = [] as Array<{ cluster: number; pnl: number }>;
    for (let w = 0; w < 10; w += 1) for (let c = 0; c < 4; c += 1) rows.push({ cluster: w, pnl: w % 2 ? 1 : -1 });
    const cse = clusteredSe(rows)!;
    const naive = 1 / Math.sqrt(rows.length); // sd of ±1 P/L is 1
    expect(cse).toBeGreaterThan(naive * 1.8);
  });
  it("the verdict is advisory only, uses clustered SE, and the release gate stays off", () => {
    const rep = validate(Array.from({ length: 60 }, (_, i) => mk(i, 0.9, 1, { yesBid: 0.88, yesAsk: 0.9 })));
    expect(rep.m1.verdict.worthHumanReview).toBe(false);
    expect(rep.m1.verdict.releaseGateUnchanged).toBe(true);
    const good = { contracts: { test: 900 }, test: { model: { brier: 0.1 }, marketMid: { brier: 0.2 } } };
    expect(verdict({ ...good, afterCostTaker: { model: { trades: 300, windows: 80, meanPerTrade: 0.05, clusteredSe: 0.01 } } }).worthHumanReview).toBe(true);
    expect(verdict({ ...good, afterCostTaker: { model: { trades: 300, windows: 80, meanPerTrade: 0.05, clusteredSe: 0.03 } } }).worthHumanReview).toBe(false);
    expect(verdict({ ...good, afterCostTaker: { model: { trades: 300, windows: 10, meanPerTrade: 0.05, clusteredSe: 0.01 } } }).worthHumanReview).toBe(false);
    expect(CALIBRATED_MODEL_APPROVED).toBe(false);
  });
});

describe("day-stop double count (review f)", () => {
  const now = Date.parse("2026-10-08T15:00:00Z");
  const base = { now, settlements: [] as Parameters<typeof buildSnapshot>[0]["settlements"], positions: [] as Parameters<typeof buildSnapshot>[0]["positions"], resting: [] as KOrder[], ordersToday: [] as KOrder[], shard2Cash: 30, exchangeTradingActive: true, exchangeCheckedAt: now };
  it("a settled contract still listed under /positions is not counted again as open exposure", () => {
    const s = buildSnapshot({
      ...base,
      settlements: [{ ticker: T, settled_time: "2026-10-08T14:45:00Z", revenue: 0, yes_total_cost_dollars: "2.00", fee_cost: "0.05" }],
      positions: [{ ticker: T, position_fp: "4.00", market_exposure_dollars: "2.00", fees_paid_dollars: "0.05" }],
    });
    expect(s.realizedToday).toBeCloseTo(-2.05, 6);
    expect(s.openWorst).toBe(0);
    expect(dayWorstOfLocal(s)).toBeCloseTo(-2.05, 6);
  });
  it("a pending send already visible in the resting list counts once (resting), not twice (resting + pending)", () => {
    const cid = cidFor(T, "yes", 1);
    const s = buildSnapshot({
      ...base,
      resting: [{ order_id: "o", client_order_id: cid, ticker: T, status: "resting", side: "bid", yes_price_dollars: "0.3000", no_price_dollars: "0.7000", remaining_count_fp: "2.00" } as KOrder],
      pendingIntents: [{ cid, worst: 0.6 }],
    });
    expect(s.restWorst).toBeCloseTo(0.6 + quadraticFee(2, 0.3), 6);
    expect(s.pendingWorst).toBe(0);
  });
});
const dayWorstOfLocal = (s: { realizedToday: number; openWorst: number; restWorst: number; pendingWorst: number }) => s.realizedToday - s.openWorst - s.restWorst - s.pendingWorst;

describe("correlated exposure across coins in the same window", () => {
  it("open, resting and pending risk is grouped by 15-minute window and direction across coins", () => {
    const now = Date.parse("2026-10-08T15:50:00Z");
    const eth = "KXETH15M-26OCT081200-00", sol = "KXSOL15M-26OCT081200-00", nextBtc = "KXBTC15M-26OCT081215-15";
    const s = buildSnapshot({
      now, settlements: [], shard2Cash: 30, exchangeTradingActive: true, exchangeCheckedAt: now,
      positions: [{ ticker: T, position_fp: "3.00", market_exposure_dollars: "1.50", fees_paid_dollars: "0" }, { ticker: nextBtc, position_fp: "-2.00", market_exposure_dollars: "1.00", fees_paid_dollars: "0" }],
      resting: [{ order_id: "r", client_order_id: "mm1-x", ticker: eth, status: "resting", side: "bid", yes_price_dollars: "0.4000", no_price_dollars: "0.6000", remaining_count_fp: "2.00" } as KOrder,
        { order_id: "r2", client_order_id: "mm1-y", ticker: sol, status: "resting", side: "ask", yes_price_dollars: "0.4000", no_price_dollars: "0.6000", remaining_count_fp: "1.00" } as KOrder],
      ordersToday: [],
      pendingIntents: [{ cid: cidFor(sol, "yes", 1), worst: 0.5 }],
    });
    expect(s.correlated!["26OCT081200|up"]).toBeCloseTo(1.5 + 0.8 + quadraticFee(2, 0.4) + 0.5, 4);
    expect(s.correlated!["26OCT081200|down"]).toBeCloseTo(0.6 + quadraticFee(1, 0.6), 4);
    expect(s.correlated!["26OCT081215|down"]).toBeCloseTo(1, 6);
  });
  it("the risk check enforces the group cap (set equal to the approved $9 aggregate; a tighter number is an owner decision)", async () => {
    const { MAX_CORRELATED_WORST_USD, MAX_OPEN_WORST_USD } = await import("./config");
    expect(MAX_CORRELATED_WORST_USD).toBe(MAX_OPEN_WORST_USD);
    const src = readFileSync(new URL("./risk.ts", import.meta.url), "utf8") as string;
    expect(src).toContain("correlated window");
  });
});

describe("review B5: a corrupt journal row cannot crash the loop, and blocks new orders", () => {
  it("unreadable rows are skipped and counted; pending risk still readable; submit refuses with zero POSTs", async () => {
    const dir = tmp("b5");
    const ok = JSON.stringify({ ts: "2026-10-08T12:00:00Z", cid: cidFor(T, "yes", 1), stage: "intent", ticker: T, worst: 1 });
    writeFileSync(join(dir, "oms-journal.jsonl"), [ok, "{torn", JSON.stringify({ ts: "x", cid: cidFor(T, "no", 1), stage: "intent", ticker: T }), JSON.stringify({ hello: 1 })].join("\n") + "\n");
    let posts = 0;
    const on = { live: () => true, begin: () => true, arm: () => true };
    const oms = new Oms(new RiskEngine(dir, on), async () => { posts += 1; return { status: 201, body: {}, text: "" }; }, async () => [], dir);
    expect(() => oms.journal()).not.toThrow();
    expect(oms.corruptRows).toBe(3);
    expect(oms.pendingIntents().map((x) => x.cid)).toEqual([cidFor(T, "yes", 1)]);
    await expect(oms.reconcilePending()).resolves.toBe(1);
    const r = await oms.submit({ product: "event", ticker: T, side: "yes", mode: "maker", price: 0.5, count: 1, fee: 0, tickId: 1 }, null);
    expect(r.ok).toBe(false);
    expect(r.why).toContain("unreadable row");
    expect(posts).toBe(0);
  });
  it("engine checks each resting order in its own try/catch", () => {
    const src = readFileSync(new URL("./engine.ts", import.meta.url), "utf8") as string;
    expect(src).toMatch(/for \(const o of this\.resting\) \{\s*try \{\s*await this\.manageOne\(o, evals, now\);/);
  });
});

describe("review B4: shadow ledger keeps the would-be trade while live is disabled", () => {
  it("decision rows carry shadow_best, displayed depth and the fee multiplier", async () => {
    const dir = tmp("b4");
    const prev = process.env.DESK_DATA_DIR;
    process.env.DESK_DATA_DIR = dir;
    try {
      const { Engine } = await import("./engine");
      const eng = new Engine();
      const shadow = { side: "no" as const, mode: "taker" as const, price: 0.4, count: 5, fee: 0.09, feePer: 0.018, edge: 0.05, edgeBase: 0.03, pSide: 0.6 };
      const e = { series: "KXBTC15M", market: null, book: { yesBid: { price: 0.58, size: 12 }, noBid: { price: 0.4, size: 7 }, ts: 0 }, pBase: 0.4, p: 0.4, shift: 0, sigma: null, spot: null, indexAge: null, feats: null, sniper: null, best: null, shadow, macro: null, failed: "G3_uncalibrated_model_shadow_only", quotes: null, tte: null, shock: 0, lockFrac: 0, guard: { cooling: false, dir: null, z: 0, triggered: false, until: 0 }, makerOk: true, makerMinEdge: 0.01, minPrice: 0, budget: 3 };
      const row = (eng as unknown as { decisionRow: (...a: unknown[]) => Record<string, unknown> }).decisionRow(e, "NO_TRADE", { feeType: "quadratic", multiplier: 1 }, 0);
      expect(row.best).toBeNull();
      expect(row.shadow_best).toMatchObject({ side: "no", mode: "taker", price: 0.4, count: 5 });
      expect(row.depth).toEqual({ yes_bid_size: 12, no_bid_size: 7 });
      expect(row.fee_multiplier).toBe(1);
      expect(row.failed_gate).toBe("G3_uncalibrated_model_shadow_only");
    } finally {
      if (prev == null) delete process.env.DESK_DATA_DIR;
      else process.env.DESK_DATA_DIR = prev;
    }
  });
  it("both blocking gates move the candidate to shadow before clearing best", () => {
    const src = readFileSync(new URL("./engine.ts", import.meta.url), "utf8") as string;
    expect(src.match(/out\.shadow = out\.best;\s*out\.best = null;/g)?.length).toBe(2);
  });
});
