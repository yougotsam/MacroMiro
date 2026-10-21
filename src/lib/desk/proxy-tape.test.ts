import { describe, expect, it } from "bun:test";
import { brierImproves } from "../deskc/scorecard";
import { clearIndexSnaps, putIndexSnap, type IndexSnap } from "./index-bars";
import { missingSteps } from "./research-cache";
import {
  admitProxy,
  clearProxies,
  parseNinjaCandles,
  parseOandaCandles,
  proxyFeedsStack,
  rollingCorrelation,
  warmProxies,
} from "./proxy-tape";
import { blindScore } from "./blind-score";

function steps(n: number, ret: (i: number) => number): { t: number; c: number }[] {
  const out: { t: number; c: number }[] = [];
  let px = 100;
  for (let i = 0; i < n; i += 1) {
    out.push({ t: i * 15 * 60_000, c: px });
    px *= Math.exp(ret(i));
  }
  return out;
}

describe("proxy gate", () => {
  it("no key does not fetch and does not admit", async () => {
    clearProxies();
    let called = false;
    const snaps = await warmProxies({
      env: {},
      fetch: async () => {
        called = true;
        throw new Error("should not fetch");
      },
    });
    expect(called).toBe(false);
    expect(snaps.length).toBe(6);
    expect(snaps.every((s) => s.why === "no key" && s.admitted === false && s.correlation == null && s.m15 == null)).toBe(true);
    expect(proxyFeedsStack("KXGOLD15M")).toBe(false);
    clearProxies();
  });

  it("a weak correlation or a missing Brier gain does not select a proxy", () => {
    const good = Array.from({ length: 40 }, () => ({ base: 0.2, alt: 0.9, y: 1 as const }));
    const weak = admitProxy({ key: true, correlation: 0.2, rows: good });
    expect(weak.admitted).toBe(false);
    expect(weak.why).toContain("correlation");
    const bare = admitProxy({ key: true, correlation: 0.99, rows: [] });
    expect(bare.admitted).toBe(false);
    expect(bare.why).toBe("no incremental brier");
    const noise = Array.from({ length: 40 }, (_, i) => {
      const y = (i % 2) as 0 | 1;
      const base = 0.35 + (i % 5) * 0.03;
      return { base, alt: base + 1e-6, y };
    });
    expect(brierImproves(noise).better).toBe(false);
    expect(admitProxy({ key: true, correlation: 0.99, rows: noise }).admitted).toBe(false);
    expect(admitProxy({ key: false, correlation: 0.99, rows: good })).toEqual({ admitted: false, why: "no key", correlation: null });
    const few = admitProxy({ key: true, correlation: 0.99, rows: good.slice(0, 10) });
    expect(few.admitted).toBe(false);
    expect(brierImproves(good).better).toBe(true);
    expect(admitProxy({ key: true, correlation: 0.99, rows: good }).admitted).toBe(true);
  });

  it("correlated returns line up, and a short overlap stays null", () => {
    const idx = steps(40, (i) => (i % 2 === 0 ? 0.01 : -0.008));
    const inv = steps(40, (i) => (i % 2 === 0 ? -0.01 : 0.008));
    expect(rollingCorrelation(idx, idx)!).toBeGreaterThan(0.99);
    expect(rollingCorrelation(idx, inv)!).toBeLessThan(0);
    expect(rollingCorrelation(idx.slice(0, 10), idx.slice(0, 10))).toBeNull();
  });

  it("does not invent a missing futures bar", () => {
    const bars = parseNinjaCandles([
      { open: 1, high: 2, low: 1, close: 1.5, volume: 10, time: 0 },
      { open: 1, high: 2, low: 1, close: 1.6, volume: 11, time: 900 },
      { open: 1, high: 2, low: 1, close: 1.7, volume: 12, time: 2700 },
    ]);
    expect(bars.map((b) => b.t)).toEqual([0, 900_000, 2_700_000]);
    expect(missingSteps(bars.map((b) => b.t), 900_000)).toBe(1);
    const fx = parseOandaCandles({
      candles: [
        { complete: true, volume: 4, time: "2026-10-20T00:00:00.000000000Z", mid: { o: "1.1", h: "1.2", l: "1.0", c: "1.15" } },
        { complete: false, volume: 9, time: "2026-10-20T00:15:00.000000000Z", mid: { o: "1.15", h: "1.2", l: "1.1", c: "1.16" } },
      ],
    });
    expect(fx).toHaveLength(1);
    expect(fx[0].v).toBe(4);
  });

  it("a proxy that has not earned the Brier gain stays out of the live score", async () => {
    clearProxies();
    clearIndexSnaps();
    const idx = steps(61, () => 0.001);
    const snap: IndexSnap = {
      series: "KXGOLD15M",
      index: "Metal.Index.1OZGOLD/USD",
      m15: idx.map((b) => ({ t: b.t, o: b.c, h: b.c, l: b.c, c: b.c })),
      h1: [],
      minutes: 0,
      gaps15: 0,
      builtAt: 0,
    };
    putIndexSnap("KXGOLD15M", snap);
    const body = idx.map((b) => ({ open: b.c, high: b.c, low: b.c, close: b.c, volume: 10, time: b.t / 1000 }));
    await warmProxies({
      env: { API_NINJAS_KEY: "test" },
      now: idx[idx.length - 1].t + 16 * 60_000,
      fetch: async (url) => {
        const u = String(url);
        const raw = u.includes("goldpricehistorical") ? body : [];
        return new Response(JSON.stringify(raw), { status: 200 });
      },
    });
    expect(proxyFeedsStack("KXGOLD15M")).toBe(false);
    const scored = blindScore("KXGOLD15M", true)!;
    expect(scored.flow.why).toBe("unavailable: no venue tape");
    expect(scored.flow.rvol).toBeNull();
    expect(scored.long.missing).toContain("real exchange volume");
    clearProxies();
    clearIndexSnaps();
  });
});
