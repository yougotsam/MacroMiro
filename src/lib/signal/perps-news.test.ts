/** Perps rules backtest, news features and MiroFish direction: the checks that keep them honest. */
import { describe, expect, it } from "bun:test";
import type { Bar } from "./ta";
import { BASE_PARAMS, aggregate, fundingTimes, kalshiFunding, runPerps, type Signal } from "./perps-backtest";
import { releaseDrift } from "./features";
import { readNews, scenarioDirection, toneZAt } from "./news";
import { macroGate } from "../desk/macro-calendar";
import { MIROFISH_PRIOR_WEIGHT } from "./config";

const T0 = Date.parse("2026-06-01T13:00:00Z");
const bar = (i: number, o: number, h: number, l: number, c: number): Bar => ({ t: T0 + i * 900_000, o, h, l, c, v: 1 });
const flat = (n: number, p = 100) => Array.from({ length: n }, (_, i) => bar(i, p, p * 1.00002, p * 0.99998, p));

describe("perps rules backtest", () => {
  it("a tight stop is capped by the 5× notional limit, so it loses less than 8%", () => {
    const b = flat(10);
    b[1] = bar(1, 100, 100.01, 99.9, 99.95);
    b[2] = bar(2, 99.9, 99.9, 98.9, 99);
    const r = runPerps({ asset: "BTC", kind: "crypto", bars: b, funds: [], releases: [], params: BASE_PARAMS, signals: [{ i: 0, side: 1, stop: 99, why: "t" }] });
    expect(r.returnPct).toBeGreaterThan(-6);
  });
  it("a stop costs about 8% of the pile, plus taker fee and slippage", () => {
    const b = flat(10);
    b[1] = bar(1, 100, 100.01, 99.9, 99.95); // trades through the 99.99 bid → filled
    b[2] = bar(2, 99.9, 99.9, 96.9, 97); // through the stop at 97 (3% away, so the 5× notional cap does not bind)
    const sig: Signal[] = [{ i: 0, side: 1, stop: 97, why: "test" }];
    const r = runPerps({ asset: "BTC", kind: "crypto", bars: b, funds: [], releases: [], params: BASE_PARAMS, signals: sig });
    expect(r.trades.length).toBe(1);
    expect(r.trades[0].how).toBe("stop");
    expect(r.returnPct).toBeLessThan(-7.5);
    expect(r.returnPct).toBeGreaterThan(-8.6);
  });
  it("an entry that is never traded through is not filled", () => {
    const b = flat(10);
    const r = runPerps({ asset: "BTC", kind: "crypto", bars: b, funds: [], releases: [], params: BASE_PARAMS, signals: [{ i: 0, side: 1, stop: 99, why: "t" }] });
    expect(r.trades.length).toBe(0);
    expect(r.unfilled).toBe(1);
  });
  it("half comes off at 1R, the stop moves to entry, the rest rides to the target", () => {
    const b = flat(12);
    b[1] = bar(1, 100, 100, 99.95, 99.97);
    b[2] = bar(2, 100, 101.2, 100, 101.1); // > 1R (≈1.0) → half off
    b[3] = bar(3, 101.1, 102.7, 101, 102.6); // > 2.5R → rest off
    const r = runPerps({ asset: "BTC", kind: "crypto", bars: b, funds: [], releases: [], params: BASE_PARAMS, signals: [{ i: 0, side: 1, stop: 99, why: "t" }] });
    expect(r.trades[0].how).toBe("target");
    expect(r.trades[0].r).toBeGreaterThan(1.5);
  });
  it("three losses in a row end the day; down 25% stops the series", () => {
    const b: Bar[] = [];
    for (let k = 0; k < 8; k++) { b.push(bar(b.length, 100, 100, 100, 100)); b.push(bar(b.length, 100, 100, 99.9, 99.95)); b.push(bar(b.length, 99.9, 99.9, 98.5, 98.6)); b.push(bar(b.length, 100, 100, 100, 100)); }
    const sig: Signal[] = Array.from({ length: 8 }, (_, k) => ({ i: k * 4, side: 1 as const, stop: 99, why: "t" }));
    const r = runPerps({ asset: "BTC", kind: "crypto", bars: b, funds: [], releases: [], params: BASE_PARAMS, signals: sig });
    expect(r.trades.length).toBe(3);
    expect(r.daysStopped).toBe(1);
  });
  it("funding follows Kalshi: 00/08/16 New York, zero under 0.01%, capped at 2%", () => {
    expect(kalshiFunding(0.00005)).toBe(0);
    expect(kalshiFunding(0.05)).toBe(0.02);
    const ts = fundingTimes(Date.parse("2026-06-01T03:00:00Z"), Date.parse("2026-06-02T03:00:00Z"));
    expect(ts.map((t) => new Date(t).toISOString().slice(11, 16))).toEqual(["04:00", "12:00", "20:00"]);
  });
  it("higher timeframes only use completed bars", () => {
    const b = flat(10);
    const h = aggregate(b, 3_600_000);
    expect(h.lastClosed[2]).toBe(-1);
    expect(h.lastClosed[3]).toBe(0);
  });
});

describe("news and MiroFish", () => {
  it("tone never reads a point newer than 30 minutes", () => {
    const pts = Array.from({ length: 800 }, (_, k) => ({ t: T0 + k * 900_000, tone: k >= 790 ? 50 : 0 }));
    const at = T0 + 790 * 900_000 + 20 * 60_000;
    expect(toneZAt(pts, at)).toBeCloseTo(0, 5);
  });
  it("release drift is the release bar's move, only inside the 15m–4h window", () => {
    const b = flat(40);
    b[10] = bar(10, 100, 102, 100, 102);
    expect(releaseDrift(b, 9, 1, [b[10].t])).toBe(0);
    expect(releaseDrift(b, 12, 1, [b[10].t])).toBeCloseTo(2 / 3, 6);
    expect(releaseDrift(b, 39, 1, [b[10].t])).toBe(0);
  });
  it("scenario direction is a direction, null when the asset is not named", () => {
    expect(scenarioDirection({ a: "Bitcoin sees a sharp liquidation and sell-off." }, "BTC")).toBeLessThan(0);
    expect(scenarioDirection({ a: "Gold captures protective capital flows and rallies." }, "GOLD")).toBeGreaterThan(0);
    expect(scenarioDirection({ a: "Nothing about coins." }, "BTC")).toBeNull();
  });
  it("a scenario run gives a direction but never a percent; down means nothing", () => {
    const now = Date.parse("2026-10-14T13:00:00Z");
    const job = { stage: "done", spec: { scenario: "baseline", catalyst: { when: "2026-10-14T12:30:00Z" } }, result: { extracted: { x: "Bitcoin rallies on inflows." } } };
    const n = readNews("BTC", { spark: null, alexandria: null, mirofish: null, research: [job] }, now);
    expect(n.mirofishP).toBeNull();
    expect(n.mirofishDir).toBe(1);
    const down = readNews("BTC", { spark: null, alexandria: null, mirofish: { stage: "unavailable" }, research: [job] }, now);
    expect(down.mirofishDir).toBeNull();
    expect(MIROFISH_PRIOR_WEIGHT).toBeLessThanOrEqual(0.2);
  });
  it("a missing calendar blocks trading", () => {
    const g = macroGate(Date.now(), "/nonexistent/official-calendar.json");
    expect(g.blocked).toBe(true);
  });
});
