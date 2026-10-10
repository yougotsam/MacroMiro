import { describe, expect, it } from "bun:test";
import { approvalRuleOos, gateTaker, pnlSummary, pnlTables, skillVsMarket, sniperTaker, type Trade } from "./analysis";
import type { Obs } from "./calibration";

const T0 = Date.UTC(2026, 9, 9, 12, 0);
function ob(i: number, over: Partial<Obs> = {}): Obs {
  const closeMs = T0 + Math.floor(i / 2) * 900_000;
  return {
    ticker: `KXBTC15M-W${Math.floor(i / 2)}-${i % 2}`, series: "KXBTC15M", model: "m", closeMs, tteBucket: 300, tte: 300,
    p: 0.6, pBase: 0.6, yesBid: 0.4, yesAsk: 0.42, mid: 0.41, y: 1, yesBidSize: 50, noBidSize: 50, feeMultiplier: 0.07, ...over,
  };
}

describe("analysis — calibration vs Kalshi mid", () => {
  it("skill is positive when the model beats the mid and negative when it does not", () => {
    const xs = Array.from({ length: 40 }, (_, i) => ob(i, { y: i % 3 ? 1 : 0 }));
    const good = skillVsMarket(xs, (o) => (o.y ? 0.8 : 0.2));
    expect(good.bss! > 0).toBe(true);
    expect(good.ci95).not.toBeNull();
    expect(good.windows).toBe(20);
    const bad = skillVsMarket(xs, (o) => (o.y ? 0.1 : 0.9));
    expect(bad.bss! < 0).toBe(true);
  });
  it("too little data yields nulls, not numbers", () => {
    const one = skillVsMarket([ob(0)]);
    expect(one.bss).toBeNull();
    expect(one.ci95).toBeNull();
  });
});

describe("analysis — executable P/L", () => {
  it("rows without recorded depth book nothing (no invented liquidity)", () => {
    const r = gateTaker([ob(0, { yesBidSize: null, noBidSize: null, p: 0.9 })]);
    expect(r.trades.length).toBe(0);
    expect(r.skipped.depthUnknown).toBe(1);
  });
  it("rows without the event fee book nothing", () => {
    const r = sniperTaker([ob(0, { feeMultiplier: null })], () => "long");
    expect(r.trades.length).toBe(0);
    expect(r.skipped.feeUnknown).toBe(1);
  });
  it("sniper buys YES at the ask within depth, after fee, one entry per contract", () => {
    const r = sniperTaker([ob(0, { noBidSize: 2 }), ob(0, { tte: 200, noBidSize: 2 })], () => "long");
    expect(r.trades.length).toBe(1);
    const t = r.trades[0];
    expect(t.side).toBe("yes");
    expect(t.price).toBe(0.42);
    expect(t.count).toBe(2);
    expect(t.fee > 0).toBe(true);
    expect(Math.abs(t.pnl - (2 * (1 - 0.42) - t.fee)) < 1e-9).toBe(true);
    expect(t.bucket).toBe("5-10m"); // tte 300 s is the first (earliest) entry; 300 s belongs to 5-10m
    expect(r.skipped.alreadyEntered).toBe(1);
  });
  it("sniper NO buys pay 1 − YES bid and lose when YES settles", () => {
    const r = sniperTaker([ob(0, { y: 1 })], () => "short");
    expect(r.trades[0].side).toBe("no");
    expect(r.trades[0].price).toBe(0.6);
    expect(r.trades[0].pnl < 0).toBe(true);
  });
  it("approval rule refuses to run without enough training data", () => {
    const r = approvalRuleOos([ob(0)], [ob(1, { p: 0.95 })]);
    expect(r.trades.length).toBe(0);
    expect(r.calibrator).toBeNull();
  });
  it("approval rule is stricter than the raw gate (subset of contracts)", () => {
    const train = Array.from({ length: 80 }, (_, i) => ob(i, { p: i % 2 ? 0.7 : 0.3, y: i % 4 === 0 ? 0 : i % 2 ? 1 : 0 }));
    const test = Array.from({ length: 40 }, (_, i) => ob(100 + i, { p: 0.55 + (i % 5) * 0.08, y: i % 3 ? 1 : 0 }));
    const g = new Set(gateTaker(test).trades.map((t) => t.ticker));
    const a = approvalRuleOos(train, test);
    for (const t of a.trades) expect(g.has(t.ticker)).toBe(true);
    expect(a.trades.length <= g.size).toBe(true);
  });
  it("tables are split by strategy, market and bucket, with clustered SE", () => {
    const mk = (s: string, series: string, bucket: string, closeMs: number, pnl: number): Trade => ({ ticker: `${series}-x`, closeMs, side: "yes", price: 0.5, count: 1, fee: 0.02, tte: 100, pnl, strategy: s, series, bucket });
    const ts = [mk("a", "KXBTC15M", "1-5m", 1, 0.5), mk("a", "KXETH15M", "1-5m", 1, 0.4), mk("a", "KXBTC15M", ">10m", 2, -0.5), mk("b", "KXBTC15M", "1-5m", 3, 0.1)];
    const t = pnlTables(ts);
    expect(t["a | ALL | ALL"].trades).toBe(3);
    expect(t["a | ALL | ALL"].windows).toBe(2);
    expect(t["a | KXBTC15M | 1-5m"].trades).toBe(1);
    expect(t["b | ALL | ALL"].trades).toBe(1);
    expect(t["a | ALL | 1-5m"].total).toBe(0.9);
    expect(pnlSummary([]).meanPerTrade).toBeNull();
  });
});
