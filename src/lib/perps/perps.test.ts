import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { parseBook, parseMarket, perpsReader, priceBand, type Book } from "./kalshi-perps-read";
import { buildPerpsCandidate, cleanBars } from "./candidates";
import { evaluateExecution } from "./execution";
import { brier, edgeReport } from "./prob-edge";
import { fundingAsOf, nextKalshiFundingMs, to15Report } from "./sim";
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
    const c = buildPerpsCandidate({ ...base, dir: "long", fundingRate8h: null, observedMs: 1_700_000_000_000, decisionMs: 1_700_000_000_000, bookKind: "synthetic_candle" });
    expect(c.gates.funding.pass).toBe(false);
    expect(c.gates.depth.pass).toBe(false);
    expect(c.funding.known).toBe(false);
    expect(c.payoff.winProbabilityState).toBe("UNKNOWN");
    expect(c.payoff.breakEvenWinRate).toBeNull();
    expect(c.decidedAt).toBe(new Date(1_700_000_000_000).toISOString());
    expect(Date.parse(c.decidedAt)).toBeLessThan(wallBefore);
    expect(c.executionClass).toBe("candle_proxy_not_a_fill");
  });
  it("venue price is dollars per contract: 1 contract moving 0.01 is $0.01, not contract_size times that", () => {
    const c = buildPerpsCandidate({ ...base, dir: "short", fundingRate8h: 0, params: { riskUsd: 1, maxNotionalUsd: 100, holdHours: 1, maxFundingAgainst: 0.0005, minDepthMultiple: 3, macroClear: false } });
    if (c.qtyContracts >= 1 && c.entry != null && c.stop != null) expect(c.riskUsd).toBeCloseTo(c.qtyContracts * Math.abs(c.entry - c.stop), 3);
  });
});

describe("execution and bars", () => {
  it("taker lift stops at displayed size", () => {
    const v = evaluateExecution(book, "long", 500, "taker");
    expect(v.executable).toBe(true);
    expect(v.takerFillQty).toBe(500);
    expect(v.queuePosition).toBe("UNKNOWN");
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
  });
  it("funding as-of ignores a later print", () => {
    const rows = [{ tMs: 100, rate: 0.01 }, { tMs: 500, rate: 0.9 }];
    expect(fundingAsOf(rows, 200).rate8h).toBe(0.01);
    expect(fundingAsOf(rows, 50).rate8h).toBeNull();
    expect(nextKalshiFundingMs(Date.parse("2026-10-15T03:00:00Z"))).toBe(Date.parse("2026-10-15T04:00:00Z"));
  });
  it("the 2026-10-15 BTC snapshot can lift 1000 and is still not a sniper trade", () => {
    const raw = JSON.parse(readFileSync(new URL("./fixtures/book-sample-2026-10-15.json", import.meta.url), "utf8"));
    const btc = raw.markets.KXBTCPERP;
    const book: Book = { bids: btc.bids, asks: btc.asks, bestBid: btc.bestBid, bestAsk: btc.bestAsk };
    const v = evaluateExecution(book, "long", 1000, "taker");
    expect(v.takerFillQty).toBe(1000);
    expect(v.takerUnfilled).toBe(0);
    expect(btc.candidates[0].decision).toBe("NO_TRADE");
    expect(btc.candidates[0].winP).toBe("UNKNOWN");
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
