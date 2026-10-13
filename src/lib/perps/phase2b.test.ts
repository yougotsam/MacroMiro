import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { marginView, maxOpenLeverage, type MarginSpec } from "./margin";
import { aggressiveProfile, sizePosition, drawdownState, CONSERVATIVE_V1_REJECTED } from "./mandate";
import { startState, stepBar, nativeTriggerRequests, type ManagePlan } from "./manage";
import { PerpsOms, FakeExchange, clientOrderId, toCreateReq, lockedTransport, PERPS_ORDERS_LOCKED, type Intent } from "./oms";
import { LocalBook, SeqTracker, CandleBuilder, eligibleMarkets } from "./stream";
import { pairCost, takerFee } from "../desk/pair-scan";
import { perpsIntel } from "./intel";

const GOLD: MarginSpec = { leverage: { "1000": 15.2735, "10000": 15.2735 }, initialMultiplier: 1.3, liqThreshold: 1 };
const BTC: MarginSpec = { leverage: { "1000": 6.3805, "10000": 6.3752, "100000": 6.3489 }, initialMultiplier: 1.3, liqThreshold: 1 };

describe("margin math", () => {
  it("max open leverage = venue / initial multiplier", () => { expect(maxOpenLeverage(GOLD, 500)).toBeCloseTo(15.2735 / 1.3, 3); });
  it("long liquidation below entry, short above; loss can exceed margin flagged", () => {
    const l = marginView(BTC, "long", 100, 8.36, 300); const s = marginView(BTC, "short", 100, 8.36, 300);
    expect(marginView(BTC, "long", 100, 8.36, 100).liquidationPrice).toBe(8.36); // 8.4x > venue max: liquidatable at entry
    expect(l.liquidationPrice!).toBeLessThan(8.36); expect(s.liquidationPrice!).toBeGreaterThan(8.36); expect(l.lossCanExceedMargin).toBe(true);
    // at liquidation, equity == maintenance
    const P = l.liquidationPrice!; expect(300 + 100 * (P - 8.36)).toBeCloseTo((1 / 6.3805) * 100 * P, 4);
  });
});

describe("aggressive mandate sizing", () => {
  it("conservative profile is recorded as rejected", () => { expect(CONSERVATIVE_V1_REJECTED.status).toBe("REJECTED_SUPERSEDED"); });
  it("wide stop → risk binds at the chosen %; tight stop → margin binds and stop stays before liquidation", () => {
    const wide = sizePosition({ profile: aggressiveProfile(0.1), equityUsd: 500, spec: GOLD, ticker: "KXGOLDPERP", group: "metals", dir: "long", entry: 4.2, stop: 3.9, feeRateIn: 0.000012, feeRateOut: 0.000072, slipPerContract: 0.0002, fundingPctOverHold: 0 });
    expect(wide.binding).toBe("risk_at_invalidation"); expect(wide.riskPctOfEquity).toBeLessThanOrEqual(10.01);
    const tight = sizePosition({ profile: aggressiveProfile(0.25), equityUsd: 500, spec: BTC, ticker: "KXBTCPERP", group: "crypto", dir: "short", entry: 8.36, stop: 8.39, feeRateIn: 0.0002, feeRateOut: 0.0012, slipPerContract: 0.0002, fundingPctOverHold: 0 });
    expect(tight.binding).not.toBe("risk_at_invalidation"); expect(tight.liq!.stopBeforeLiq).toBe(true); expect(tight.initialMarginUsd).toBeLessThanOrEqual(450.01);
  });
  it("correlated exposure reduces size", () => {
    const base = { profile: aggressiveProfile(0.25), equityUsd: 1000, spec: BTC, ticker: "KXETHPERP", group: "crypto", dir: "long" as const, entry: 2.52, stop: 2.5, feeRateIn: 0.0002, feeRateOut: 0.0012, slipPerContract: 0.0002, fundingPctOverHold: 0 };
    expect(sizePosition({ ...base, open: [{ ticker: "KXBTCPERP", group: "crypto", initialMarginUsd: 700 }] }).qty).toBeLessThan(sizePosition(base).qty);
  });
  it("drawdown warns; halts only at an operator-chosen limit", () => {
    expect(drawdownState(aggressiveProfile(0.15), 1000, 600).halted).toBe(false);
    expect(drawdownState(aggressiveProfile(0.15, 0.3), 1000, 600).halted).toBe(true);
  });
});

describe("management (shared by sim and OMS)", () => {
  const p: ManagePlan = { dir: "long", qty: 10, entry: 100, stop: 99, t1: 101, t2: 102, partialFrac: 0.5, trailR: 1, maxHoldMs: 3600_000 };
  it("partial at T1 then break-even stop", () => {
    let s = startState(p); s = stepBar(p, s, { t: 0, o: 100, h: 101.2, l: 99.8, c: 101 }, 0, 0);
    expect(s.open).toBe(5); expect(s.stop).toBeGreaterThanOrEqual(100);
    s = stepBar(p, s, { t: 60_000, o: 101, h: 101, l: 99.9, c: 100 }, 0, 0); expect(s.closed).toBe(true); expect(s.exits.at(-1)!.reason).toBe("trail");
  });
  it("gap through stop fills at the open", () => { const s = stepBar(p, startState(p), { t: 0, o: 98, h: 98.5, l: 97, c: 98 }, 0, 0); expect(s.exits[0].reason).toBe("gap_stop"); expect(s.realized).toBe(-20); });
  it("native trigger bodies only use documented fields", () => {
    const allowed = new Set(["kind", "anchor_order_id", "client_trigger_id", "count", "stop_loss_price", "take_profit_price", "trail_amount", "trail_bps"]);
    for (const b of nativeTriggerRequests(p, "ord-1", "mm-perps-x")) for (const k of Object.keys(b)) expect(allowed.has(k)).toBe(true);
  });
});

describe("perps OMS (locked) against an in-memory exchange", () => {
  const i: Intent = { kind: "entry", ticker: "KXBTCPERP", dir: "long", qty: 3, price: 8.36, maker: false, decisionId: "d1" };
  it("lock is on and the live transport refuses", async () => { expect(PERPS_ORDERS_LOCKED).toBe(true); await expect(lockedTransport.createOrder(toCreateReq(i))).rejects.toThrow(/LOCKED/); });
  it("default OMS never sends", async () => { const x = new FakeExchange(); const o = new PerpsOms(x); expect((await o.submit(i)).status).toMatch(/LOCKED/); expect(x.orders.length).toBe(0); });
  it("idempotent cid, duplicate refused, timeout → UNKNOWN → reconcile (no resend)", async () => {
    const x = new FakeExchange(); const o = new PerpsOms(x, null, true);
    expect(clientOrderId(i)).toBe(clientOrderId({ ...i })); x.failNextCreateAfterAccept = true;
    expect((await o.submit(i)).status).toMatch(/UNKNOWN/); expect((await o.submit(i)).status).toMatch(/DUPLICATE/); expect(x.orders.length).toBe(1);
    const r = await o.reconcile(0); expect(r.resolved.length).toBe(1);
  });
  it("refuses reversal; exits are reduce-only; unknown venue order blocks", async () => {
    const x = new FakeExchange(); const o = new PerpsOms(x, null, true); await o.submit(i);
    expect((await o.submit({ ...i, dir: "short", decisionId: "d2" }, await x.positions())).status).toMatch(/reverse/);
    expect(toCreateReq({ ...i, kind: "exit" })).toMatchObject({ side: "ask", reduce_only: true });
    await x.createOrder({ ...toCreateReq({ ...i, decisionId: "manual" }), client_order_id: "manual-1" });
    await o.reconcile(0); expect(o.blocked).toMatch(/unknown venue orders/);
  });
  it("kill requires the operator token, cancels all and flattens reduce-only", async () => {
    const x = new FakeExchange(); const o = new PerpsOms(x, null, true); await o.submit(i);
    expect((await o.killAndFlatten("bad", "tok", {}, "k")).ok).toBe(false);
    const k = await o.killAndFlatten("tok", "tok", { KXBTCPERP: { bestBid: 8.35, bestAsk: 8.37 } }, "k");
    expect(k.ok).toBe(true); expect(Number((await x.positions())[0].position)).toBe(0);
    expect(PerpsOms.pnlFromFills(await x.fills(), new Set(x.orders.map((q) => q.order_id))).fills).toBe(2);
  });
  it("restart recovery flags unmanaged exchange positions", async () => {
    const x = new FakeExchange(); x.applyFill("ext", "KXGOLDPERP", "bid", 5, 4.2, true);
    const o = new PerpsOms(x, null, true); const r = await o.recover(0); expect(r.unmanaged).toContain("KXGOLDPERP"); expect(o.blocked).toMatch(/unmanaged/);
  });
  it("oms.ts has no fetch/network code", () => { expect(readFileSync(new URL("./oms.ts", import.meta.url), "utf8")).not.toMatch(/fetch\(|WebSocket|https?:\/\//); });
});

describe("collector pieces", () => {
  it("seq gap per subscription is detected", () => { const s = new SeqTracker(); expect(s.ok(2, 1)).toBe(true); expect(s.ok(2, 2)).toBe(true); expect(s.ok(2, 4)).toBe(false); });
  it("book applies deltas and removes empty levels", () => { const b = new LocalBook(); b.snapshot({ bid: [["1.0", "5"]], ask: [["1.1", "3"]] }, 1); b.delta({ price: "1.0", delta: "-5", side: "bid" }); expect(b.top().bestBid).toBeNull(); });
  it("candles from trades with buy/sell volume, dedup by trade_id", () => {
    const c = new CandleBuilder(60_000); c.add({ trade_id: "a", market_ticker: "X", price: "1", count: "2", taker_side: "bid", ts_ms: 1000 }); c.add({ trade_id: "a", market_ticker: "X", price: "1", count: "2", taker_side: "bid", ts_ms: 1000 });
    const out = c.add({ trade_id: "b", market_ticker: "X", price: "2", count: "1", taker_side: "ask", ts_ms: 61_000 }); expect(out[0]).toMatchObject({ v: 2, buyV: 2, n: 1 });
  });
  it("registry puts BTC/ETH/GOLD first", () => { expect(eligibleMarkets([{ ticker: "KXSOLPERP", status: "active", volume24hUsd: 1e7, openInterestUsd: 1e6 }, { ticker: "KXGOLDPERP", status: "active", volume24hUsd: 1, openInterestUsd: 1 }])[0]).toBe("KXGOLDPERP"); });
});

describe("pair scanner + intel", () => {
  it("single-book YES+NO pair cannot be < $1 unless crossed", () => { expect(pairCost({ ticker: "t", yesBid: 0.5, noBid: 0.48 }, takerFee).status).toBe("NO_ARB"); });
  it("intel only uses items available before the decision", () => {
    const r = perpsIntel("KXXRPPERP", Date.parse("2026-10-09T12:00:00Z"), { calendar: null, intelEvents: [{ title: "x", assets: ["XRP"], publishedAt: "2026-10-09T06:00:00Z", detectedAt: "2026-10-10T00:00:00Z" }], mirofish: null, spark: null, evidence: [] });
    expect(r.rows.find((x) => x.event === "x")!.usable).toBe("LATE"); expect(Math.abs(r.intelScore)).toBe(0); expect(r.macroClear).toBe(false);
  });
});
