import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateSniper, type Candle } from "./sniper";
import { flowFromBars, type FeatureSnapshot } from "./features";
import { BarStore, bookImbalance, fetchPublicTrades, type PublicTrade } from "./market-data";
import { MIN_15, armResearch, barsForSniper, clearResearch, flowRefusal, missingSteps, putResearch, researchFor, warmResearch } from "./research-cache";

function climb(n: number, stepMs: number): Candle[] {
  const out: Candle[] = [];
  let px = 100;
  for (let i = 0; i < n; i += 1) {
    const c = px + 0.4;
    out.push({ t: i * stepMs, o: px, h: c + 0.2, l: px - 0.2, c, v: 10 + (i % 5) });
    px = c;
  }
  return out;
}

const votes = (): FeatureSnapshot => ({
  bars: 30,
  ema7: 1, ema14: 1, ema20: 1, ema50: 1, ema200: 1, rsi14: 40, ret5mBps: 1,
  candle: "bull_engulf",
  structure: "ote_long",
  groups: { trend: 0.5, momentum: -0.25, structure: 0.5, candle: -0.5 },
  flow: { rvol: 1.8, cvd: null, vwap: 100, ofi: 3, book: null, source: "coinbase:BTC-USD", stale: false, why: "no signed trades" },
  score: 0.1,
});

describe("sniper history", () => {
  it("uses stored 15-minute bars once there are 60, and does not invent a gap", () => {
    clearResearch();
    const index = climb(2, 60_000);
    putResearch("KXBTC15M", { m15: climb(MIN_15, 15 * 60_000), h1: climb(10, 3600_000), source: "coinbase:BTC-USD", at: 0, fresh: false, why: null, ofi: null, book: null });
    const chosen = barsForSniper("KXBTC15M", index, index);
    expect(chosen.m15).toHaveLength(MIN_15);
    expect(chosen.source).toBe("coinbase:BTC-USD");
    expect(missingSteps([0, 60_000, 180_000], 60_000)).toBe(1);
    const sniper = evaluateSniper(chosen.m15, climb(10, 3600_000), "long", true);
    expect(sniper.missing.includes("60 complete 15m bars")).toBe(false);
    expect(sniper.score).toBeGreaterThan(0);
    clearResearch();
  });

  it("sits a mapped product when the tape is stale, and does not sit gold", () => {
    clearResearch();
    armResearch(true);
    expect(flowRefusal("KXBTC15M")).toBe("G1_flow_stale");
    expect(flowRefusal("KXGOLD15M")).toBeNull();
    clearResearch();
  });
});

describe("feature log", () => {
  it("keeps the votes as numbers and does not turn a missing tape into zero", () => {
    const snap = votes();
    const logged = { group_votes: snap.groups, flow: snap.flow, structure: snap.structure, candle: snap.candle };
    const back = JSON.parse(JSON.stringify(logged)) as typeof logged;
    expect(back.group_votes.structure).toBe(0.5);
    expect(back.group_votes.candle).toBe(-0.5);
    expect(typeof back.structure).toBe("string");
    const bare = flowFromBars(climb(30, 15 * 60_000).map((b) => ({ ...b, v: undefined, delta: undefined })), "coinbase:BTC-USD", true, null);
    expect(bare.rvol).toBeNull();
    expect(bare.cvd).toBeNull();
    expect(bare.why).not.toBeNull();
    const withVol = flowFromBars(climb(30, 15 * 60_000), "coinbase:BTC-USD", true, 4);
    expect(withVol.rvol).toBeGreaterThan(0);
    expect(withVol.cvd).toBeNull();
    expect(withVol.ofi).toBe(4);
    expect(withVol.book).toBeNull();
    expect(withVol.why).toContain("no signed trades");
    expect(withVol.why).toContain("no book");
    const eight = climb(8, 15 * 60_000).map((b, i) => ({ ...b, delta: i % 2 === 0 ? 1 : -0.25 }));
    expect(flowFromBars(eight, "coinbase:BTC-USD", true, 1, null).cvd).toBeCloseTo(3);
    const seven = eight.map((b, i) => (i === 3 ? { ...b, delta: undefined } : b));
    const partial = flowFromBars(seven, "coinbase:BTC-USD", true, 1, null);
    expect(partial.cvd).toBeNull();
    expect(partial.why).toContain("signed 7/8");
  });
});

function grid(n: number, minutes: number, now: number): Candle[] {
  const ms = minutes * 60_000;
  const end = Math.floor(now / ms) * ms - ms;
  const out: Candle[] = [];
  let px = 100;
  for (let i = n - 1; i >= 0; i -= 1) {
    const t = end - i * ms;
    const c = px + 0.4;
    out.push({ t, o: px, h: c + 0.2, l: px - 0.2, c, v: 10 + (i % 5) });
    px = c;
  }
  return out;
}

describe("coinbase warm", () => {
  it("keeps a missing book as null and does not invent a bar across a gap", async () => {
    clearResearch();
    const now = Date.parse("2026-10-20T12:00:00Z");
    const m15 = grid(70, 15, now).filter((_, i) => i !== 10);
    const h1 = grid(210, 60, now);
    const store = new BarStore(mkdtempSync(join(tmpdir(), "bars-")));
    const tape: PublicTrade[] = [
      { trade_id: 1, side: "sell", size: "2", price: "1", time: new Date(m15[0].t + 1000).toISOString() },
      { trade_id: 2, side: "buy", size: "0.5", price: "1", time: new Date(m15[m15.length - 1].t + 14 * 60_000).toISOString() },
    ];
    await warmResearch(now, {
      candles: async (_product, minutes) => (minutes === 15 ? m15 : h1),
      trades: async () => tape,
      book: async () => null,
      store,
    });
    const snap = researchFor("KXBTC15M");
    expect(snap?.source).toBe("coinbase:BTC-USD");
    expect(snap?.m15.length).toBe(m15.length);
    expect(missingSteps(snap?.m15.map((b) => b.t) ?? [], 15 * 60_000)).toBeGreaterThan(0);
    expect(snap?.m15.some((b) => typeof b.delta === "number")).toBe(true);
    expect(snap?.ofi).toBeCloseTo(1.5);
    expect(snap?.book).toBeNull();
    expect(snap?.fresh).toBe(true);
    expect(researchFor("KXGOLD15M")?.why).toBe("no coinbase product");
    const down = new BarStore(mkdtempSync(join(tmpdir(), "bars-")));
    await warmResearch(now, {
      candles: async () => {
        throw new Error("down");
      },
      trades: async () => [],
      book: async () => null,
      store: down,
    });
    expect(researchFor("KXBTC15M")?.why).toBe("coinbase_fetch_failed");
    expect(researchFor("KXBTC15M")?.fresh).toBe(false);
    expect(bookImbalance({ bids: [["10", "3", 1]], asks: [["11", "1", 1]] })?.imbalance).toBeCloseTo(0.5);
    expect(bookImbalance({ bids: [["10", "0", 1]], asks: [["11", "0", 1]] })).toBeNull();
    let pages = 0;
    const kept = await fetchPublicTrades("BTC-USD", async () => {
      pages += 1;
      if (pages > 1) throw new Error("429");
      return [{ trade_id: 9, side: "sell", size: "1", price: "1", time: "2026-10-20T00:00:00Z" }];
    }, 0, 5, 0);
    expect(kept).toHaveLength(1);
    clearResearch();
  });
});
