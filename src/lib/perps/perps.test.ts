import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { parseBook, parseMarket, perpsReader, priceBand, type Book } from "./kalshi-perps-read";
import { buildPerpsCandidate, cleanBars } from "./candidates";
import { evaluateExecution } from "./execution";
import { brier, edgeReport } from "./prob-edge";
import { fundingAsOf, fundingClocksInHold, nextKalshiFundingMs, to15Report, contiguousLookback } from "./sim";
import { replayBooks } from "./book-replay";
import { pickCurrentReplay, emptyTradeReport } from "./replay-report";
import { researchTrace } from "./research-features";
import { perpsOrders, PerpsOrdersLocked, PERPS_ORDERS_LOCKED } from "./order-adapter";
import type { Candle } from "@/lib/desk/sniper";

const book = parseBook({ orderbook: { bids: [["8.3457", "313"], ["8.3467", "250"]], asks: [["8.3494", "7000"], ["8.3473", "194"]] } });
const market = parseMarket({ ticker: "KXBTCPERP", contract_size: "0.000100", tick_size: "0.0001", bid: "8.3467", ask: "8.3473" });
const bars = (n: number, step: number, base = 8.3): Candle[] => Array.from({ length: n }, (_, i) => ({ t: i * step, o: base + Math.sin(i / 5) * 0.02, h: base + Math.sin(i / 5) * 0.02 + 0.01, l: base + Math.sin(i / 5) * 0.02 - 0.01, c: base + Math.sin((i + 1) / 5) * 0.02, v: 10 }));

describe("perps read adapter", () => {
  it("source has no write verbs (GET only)", () => {
    const src = readFileSync(new URL("./kalshi-perps-read.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/method:\s*"(POST|DELETE|PUT|PATCH)"/);
    expect(src).not.toMatch(/kalshiSignedHeaders\("(POST|DELETE)"/);
  });
  it("best bid is the highest bid and best ask the lowest ask (venue sorts ascending)", () => {
    expect(book.bestBid).toBe(8.3467); expect(book.bestAsk).toBe(8.3473);
  });
  it("price band follows docs: min(0.8·bid, bid−1000 ticks), max(1.2·ask, ask+1000 ticks)", () => {
    const b = priceBand(book, 0.0001);
    expect(b.minBid).toBeCloseTo(Math.min(0.8 * 8.3467, 8.3467 - 0.1), 6);
    expect(b.maxAsk).toBeCloseTo(Math.max(1.2 * 8.3473, 8.3473 + 0.1), 6);
  });
  it("reader parses funding estimate with ms timestamps from a mocked GET", async () => {
    const paths: string[] = [];
    const r = perpsReader(async (p) => { paths.push(p); return { funding_rate: 0.00019, next_funding_time: "2026-10-13T04:00:00Z", mark_price: "8.24", computed_time: "2026-10-12T22:43:40Z" }; });
    const f = await r.fundingEstimate("KXBTCPERP");
    expect(f.rate).toBe(0.00019); expect(f.nextMs).toBe(Date.parse("2026-10-13T04:00:00Z"));
    expect(paths[0]).toBe("/funding_rates/estimate?ticker=KXBTCPERP");
  });
});

describe("perps candidates", () => {
  const base = { market, book, b15: bars(80, 900_000), b1h: bars(220, 3_600_000), makerRate: 0.0002, takerRate: 0.0012, fundingRate8h: 0.0002, nextFundingMs: 0, observedMs: 0 };
  it("maker entry joins our side, stop beyond entry, targets 1R/2R, notional capped", () => {
    const c = buildPerpsCandidate({ ...base, dir: "long" });
    expect(c.entry).toBe(8.3467);
    expect(c.stop!).toBeLessThan(c.entry!);
    expect(c.target2! - c.entry!).toBeCloseTo(2 * (c.entry! - c.stop!), 3);
    expect(c.notionalUsd).toBeLessThanOrEqual(100);
    expect(c.decision).toBe("NO_TRADE"); // synthetic bars → no 9+/13
  });
  it("funding against the side beyond the cap fails the funding gate", () => {
    const c = buildPerpsCandidate({ ...base, dir: "long", fundingRate8h: 0.001 });
    expect(c.gates.funding.pass).toBe(false);
    expect(buildPerpsCandidate({ ...base, dir: "short", fundingRate8h: 0.001 }).gates.funding.pass).toBe(true);
  });
  it("loss path pays maker + taker fees, win path maker + maker", () => {
    const c = buildPerpsCandidate({ ...base, dir: "short", fundingRate8h: 0 });
    expect(c.costs.lossCostUsd).toBeGreaterThan(c.costs.winCostUsd);
    expect(c.costs.winCostUsd).toBeCloseTo(c.notionalUsd * 0.0004, 4);
  });
  it("impossible bars are dropped; more than 2% dropped fails data_ready", () => {
    const b = bars(80, 900_000); for (let k = 10; k < 20; k++) b[k] = { ...b[k], l: 0.01 };
    expect(cleanBars(b).dropped).toBe(10);
    expect(buildPerpsCandidate({ ...base, b15: b, dir: "long" }).gates.data_ready.pass).toBe(false);
  });
  it("unknown funding is not zero and a synthetic book cannot pass depth", () => {
    const wallBefore = Date.now();
    const c = buildPerpsCandidate({ ...base, dir: "long", fundingRate8h: null, observedMs: 1_700_000_000_000, receivedMs: 1_700_000_000_000, decisionMs: 1_700_000_000_000, bookKind: "synthetic_candle" });
    expect(c.gates.funding.pass).toBe(false);
    expect(c.gates.depth.pass).toBe(false);
    expect(c.funding.known).toBe(false);
    expect(c.payoff.winProbabilityState).toBe("UNKNOWN");
    expect(c.payoff.winUsdNet).toBeNull();
    expect(c.payoff.lossUsdNet).toBeNull();
    expect(c.payoff.breakEvenWinRate).toBeNull();
    expect(c.schema).toBe("perps-candidate/v2");
    expect(c.timeSource).toBe("caller");
    expect(c.decidedAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(Date.parse(c.decidedAt)).toBeLessThan(wallBefore);
    expect(c.executionClass).toBe("candle_proxy_not_a_fill");
  });
  it("a missing decision time is the construction clock, not the request start", () => {
    const old = Date.now() - 86_400_000;
    const c = buildPerpsCandidate({ ...base, dir: "long", observedMs: old });
    expect(c.timeSource).toBe("construction_clock");
    expect(Date.parse(c.decidedAt)).toBeGreaterThan(old + 60_000);
  });
  it("venue price is dollars per contract and the assertion cannot skip a zero size", () => {
    const flat = (n: number, step: number): Candle[] => Array.from({ length: n }, (_, i) => ({ t: i * step, o: 8.35, h: 8.351, l: 8.349, c: 8.35, v: 10 }));
    const c = buildPerpsCandidate({ ...base, b15: flat(80, 900_000), b1h: flat(220, 3_600_000), dir: "long", fundingRate8h: 0, params: { riskUsd: 5, maxNotionalUsd: 100, holdHours: 1, maxFundingAgainst: 0.0005, minDepthMultiple: 3, macroClear: false } });
    expect(c.qtyContracts).toBeGreaterThanOrEqual(1);
    expect(c.entry).not.toBeNull();
    expect(c.stop).not.toBeNull();
    expect(c.riskUsd).toBeCloseTo(c.qtyContracts * Math.abs(c.entry! - c.stop!), 3);
  });
});

describe("execution and bars", () => {
  it("taker lift stops at displayed size", () => {
    const v = evaluateExecution(book, "long", 500, "taker");
    expect(v.executable).toBe(true);
    expect(v.takerFillQty).toBe(500);
    expect(v.queuePosition).toBe("UNKNOWN");
    const over = evaluateExecution(book, "long", 20_000, "taker");
    const shown = book.asks.reduce((s, x) => s + x[1], 0);
    expect(shown).toBe(7194);
    expect(over.takerFillQty).toBe(shown);
    expect(over.takerUnfilled).toBe(20_000 - shown);
    expect(over.limitPrice).toBe(book.asks[book.asks.length - 1][0]);
    expect(over.takerVwap).toBeLessThan(over.limitPrice!);
    const two = evaluateExecution({ bids: [[1, 10]], asks: [[1, 10], [2, 10]], bestBid: 1, bestAsk: 1 }, "long", 20, "taker");
    expect(two.takerFillQty).toBe(20);
    expect(two.takerVwap).toBeCloseTo(1.5, 6);
    expect(two.limitPrice).toBe(2);
    expect(evaluateExecution(book, "long", 10, "taker", "synthetic_candle").executable).toBe(false);
  });
  it("a 10-minute bucket is incomplete; 15 aligned minutes become one bar", () => {
    const start = 1_700_000_000_000;
    const bucket = Math.floor(start / 900_000) * 900_000;
    const ten = Array.from({ length: 10 }, (_, i) => ({ t: bucket + i * 60_000, o: 1, h: 1, l: 1, c: 1, v: 1 }));
    expect(to15Report(ten, bucket + 900_000).bars).toHaveLength(0);
    expect(to15Report(ten, bucket + 900_000).incomplete[0].reason).toMatch(/10\/15/);
    const full = Array.from({ length: 15 }, (_, i) => ({ t: bucket + i * 60_000, o: 1, h: 2, l: 0.5, c: 1.5, v: 1 }));
    const built = to15Report(full, bucket + 900_000);
    expect(built.bars).toHaveLength(1);
    expect(built.bars[0].h).toBe(2);
    expect(built.bars[0].l).toBe(0.5);
    const hole = [...ten.map((k) => ({ ...k, t: bucket + k.t - bucket })), ...Array.from({ length: 15 }, (_, i) => ({ t: bucket + 2 * 900_000 + i * 60_000, o: 1, h: 1, l: 1, c: 1, v: 1 }))];
    const gapped = to15Report(hole, bucket + 3 * 900_000);
    expect(gapped.incomplete.some((x) => x.minutes === 0 && /0\/15/.test(x.reason))).toBe(true);
    expect(gapped.bars).toHaveLength(1);
    const look = contiguousLookback([{ t: 0 }, { t: 900_000 }, { t: 2_700_000 }], 2, 120);
    expect(look.map((x) => x.t)).toEqual([2_700_000]);
  });
  it("funding as-of ignores a later print", () => {
    const rows = [{ tMs: 100, rate: 0.01 }, { tMs: 500, rate: 0.9 }];
    expect(fundingAsOf(rows, 200).rate8h).toBe(0.01);
    expect(fundingAsOf(rows, 50).rate8h).toBeNull();
    expect(nextKalshiFundingMs(Date.parse("2026-10-15T03:00:00Z"))).toBe(Date.parse("2026-10-15T04:00:00Z"));
    const holdStart = Date.parse("2026-10-15T03:30:00Z");
    expect(fundingClocksInHold(holdStart, 30 * 60_000)).toEqual([Date.parse("2026-10-15T04:00:00Z")]);
    expect(fundingClocksInHold(Date.parse("2026-10-15T04:05:00Z"), 3 * 3_600_000)).toEqual([]);
  });
  it("the BTC snapshot is rebuilt by the selector, and a taker larger than the book is partial", () => {
    const raw = JSON.parse(readFileSync(new URL("./fixtures/book-sample-2026-10-15.json", import.meta.url), "utf8"));
    const btc = raw.markets.KXBTCPERP;
    const snap: Book = { bids: btc.bids, asks: btc.asks, bestBid: btc.bestBid, bestAsk: btc.bestAsk };
    const shown = snap.asks.reduce((s, x) => s + x[1], 0);
    const v = evaluateExecution(snap, "long", shown + 500, "taker");
    expect(v.takerFillQty).toBe(shown);
    expect(v.takerUnfilled).toBe(500);
    const c = buildPerpsCandidate({ market, book: snap, b15: [], b1h: [], dir: "long", makerRate: 0.0002, takerRate: 0.0012, fundingRate8h: btc.funding8h, nextFundingMs: Date.parse(btc.nextFunding), observedMs: Date.parse(raw.capturedAt), receivedMs: Date.parse(raw.capturedAt), decisionMs: Date.parse(raw.capturedAt) });
    expect(c.decision).toBe("NO_TRADE");
    expect(c.payoff.winProbabilityState).toBe("UNKNOWN");
    expect(c.schema).toBe("perps-candidate/v2");
  });
  it("book events replay, a gap invalidates the book, and legacy sims are quarantined", () => {
    const events = [
      { kind: "orderbook_snapshot" as const, market_ticker: "KXBTCPERP", sid: 1, seq: 1, venueTs: 1, rx: 2, bid: [["8.1", "10"]], ask: [["8.2", "4"]] },
      { kind: "orderbook_delta" as const, market_ticker: "KXBTCPERP", sid: 1, seq: 2, venueTs: 3, rx: 4, price: "8.2", delta: "6", side: "ask" as const },
      { kind: "seq_gap" as const, sid: 1, seq: 9, venueTs: null, rx: 5 },
      { kind: "orderbook_delta" as const, market_ticker: "KXBTCPERP", sid: 1, seq: 10, venueTs: 6, rx: 7, price: "8.2", delta: "-100", side: "ask" as const },
    ];
    const mid = replayBooks(events.slice(0, 2));
    expect(mid.books.KXBTCPERP.askDepth).toBe(10);
    expect(mid.books.KXBTCPERP.executable).toBe(true);
    const after = replayBooks(events);
    expect(after.gaps).toBe(1);
    expect(after.books.KXBTCPERP.stale).toBe(true);
    expect(after.books.KXBTCPERP.executable).toBe(false);
    expect(after.books.KXBTCPERP.askDepth).toBe(10);
    const picked = pickCurrentReplay([{ name: "sim-1.json", label: "CAUSAL_REPLAY_1M_CANDLES" }, { name: "sim-2.json", label: "CANDLE_ONLY_NOT_EXECUTABLE" }]);
    expect(picked.file).toBe("sim-2.json");
    expect(picked.quarantined).toEqual(["sim-1.json"]);
    expect(emptyTradeReport([]).note).toMatch(/zero trades/);
    expect(emptyTradeReport(undefined).trades).toBe(0);
    const feat = researchTrace({ mirofish: { headline: "x", probability: null, at: 1, stage: "error: down", source: "local" }, spark: { status: "processing", at: "2026-10-13T20:14:35.008Z" } });
    expect(feat.every((f) => f.state === "UNKNOWN")).toBe(true);
  });
  it("brier is null with no outcomes", () => {
    expect(brier([])).toBeNull();
    expect(edgeReport("kalshi_perps_target_before_stop", 0.4, []).modelProbability).toBe("UNKNOWN");
    expect(brier([{ p: 0.25, y: 1 }, { p: 0.25, y: 0 }])).toBeCloseTo((0.75 ** 2 + 0.25 ** 2) / 2, 6);
  });
});

describe("perps order adapter is locked off", () => {
  it("every method throws", () => {
    expect(PERPS_ORDERS_LOCKED).toBe(true);
    for (const f of [() => perpsOrders.create({}), () => perpsOrders.amend({}), () => perpsOrders.cancel({}), () => perpsOrders.cancelAll()]) expect(f).toThrow(PerpsOrdersLocked);
  });
  it("has no network code", () => {
    const src = readFileSync(new URL("./order-adapter.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/fetch\(|kalshiSignedHeaders|WebSocket/);
  });
});
