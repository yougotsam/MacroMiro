import { describe, expect, it } from "bun:test";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { marginView, maxOpenLeverage, type MarginSpec } from "./margin";
import { aggressiveProfile, sizePosition, drawdownState, CONSERVATIVE_V1_REJECTED } from "./mandate";
import { startState, stepBar, nativeTriggerRequests, trailingStopBody, breakEvenStopBody, type ManagePlan } from "./manage";
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
    const fresh = nativeTriggerRequests(p, "ord-1", "mm-perps-x");
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).not.toHaveProperty("count");
    const open = nativeTriggerRequests(p, "ord-1", "mm-perps-x", true);
    expect(open).toHaveLength(2);
    for (const b of open) {
      for (const k of Object.keys(b)) expect(allowed.has(k)).toBe(true);
      expect(b.count != null && b.anchor_order_id != null).toBe(false);
      expect(String(b.client_trigger_id).length).toBeLessThanOrEqual(64);
    }
    expect(trailingStopBody(p)).toEqual({ kind: "trailing", trail_amount: "1.0000" });
    expect(breakEvenStopBody(100)).toEqual({ stop_loss_price: "100.0000" });
  });
});

describe("perps OMS (locked) against an in-memory exchange", () => {
  const i: Intent = { kind: "entry", ticker: "KXBTCPERP", dir: "long", qty: 3, price: 8.36, maker: false, decisionId: "d1", plan: { dir: "long", qty: 3, entry: 8.36, stop: 8.26, t1: 8.46, t2: 8.66, partialFrac: 0.5, trailR: 1, maxHoldMs: 3600_000 } };
  it("refuses a malformed or absent stop before the venue receives an entry", async () => {
    const x = new FakeExchange();
    const o = new PerpsOms(x, null, true, () => ({ ok: true, why: "fixture" }));
    expect((await o.submit({ ...i, decisionId: "no-protective-plan", plan: undefined })).status).toMatch(/REFUSED/);
    expect((await o.submit({ ...i, decisionId: "bad-stop", plan: { ...i.plan!, stop: i.price + 0.1 } })).status).toMatch(/REFUSED/);
    expect(x.orders).toHaveLength(0);
  });
  it("the stub transport still refuses, and a fake exchange receives a send", async () => {
    expect(PERPS_ORDERS_LOCKED).toBe(false);
    await expect(lockedTransport.createOrder(toCreateReq(i))).rejects.toThrow(/LOCKED/);
    const x = new FakeExchange();
    const o = new PerpsOms(x);
    expect((await o.submit(i)).status).toBe("ACK");
    expect(x.orders.length).toBe(1);
  });
  it("a rejected exit trigger is not an ACK and blocks subsequent entries", async () => {
    const x = new FakeExchange();
    x.setCrossExitTrigger = async () => { throw new Error("simulated venue trigger rejection"); };
    const o = new PerpsOms(x, null, true, () => ({ ok: true, why: "test" }));
    const plan: ManagePlan = { dir: "long", qty: 3, entry: 8.36, stop: 8.26, t1: 8.46, t2: 8.66, partialFrac: 0.5, trailR: 1, maxHoldMs: 3600_000 };
    const result = await o.submit({ ...i, plan, decisionId: "failed-protection" });
    expect(result.status).toMatch(/PROTECTION_FAILED/);
    expect(result.order_id).toBeTruthy();
    expect(o.stateOf(result.cid)).toBe("PROTECTION_FAILED");
    expect(o.blocked).toMatch(/unprotected entry/);
    expect((await o.submit({ ...i, decisionId: "another-entry" })).status).toMatch(/BLOCKED/);
    // A stop alarm must never block a reduce-only emergency exit.
    const reduced = await o.submit({ ...i, kind: "exit", decisionId: "reduce-after-trigger-failure" }, await x.positions());
    expect(reduced.status).toBe("ACK");
    expect(x.orders).toHaveLength(2);
    expect(x.orders[1].reduce_only).toBe(true);
  });
  it("confirmed immediate fills require venue stop and target readback", async () => {
    const x = new FakeExchange();
    const o = new PerpsOms(x, null, true, () => ({ ok: true, why: "test" }));
    const plan: ManagePlan = { dir: "long", qty: 3, entry: 8.36, stop: 8.26, t1: 8.46, t2: 8.66, partialFrac: 0.5, trailR: 1, maxHoldMs: 3600_000 };
    const entry = { ...i, decisionId: "instant-protection", plan };
    const ack = await o.submit(entry);
    expect(ack.status).toBe("ACK");
    expect(o.stateOf(ack.cid)).toBe("PROTECTION_VERIFIED");
    expect(x.triggers.length).toBe(1);
  });
  it("a filled position without a protective bracket can be armed after a fill", async () => {
    const x = new FakeExchange();
    const o = new PerpsOms(x, null, true, () => ({ ok: true, why: "test" }));
    const plan: ManagePlan = { dir: "long", qty: 3, entry: 8.36, stop: 8.26, t1: 8.46, t2: 8.66, partialFrac: 0.5, trailR: 1, maxHoldMs: 3600_000 };
    const entry = { ...i, decisionId: "later-fill", plan };
    x.applyFill("external-order", "KXBTCPERP", "bid", 3, 8.36, true);
    const result = await o.ensureAfterFill(entry, "external-order");
    expect(result.state).toBe("PROTECTION_VERIFIED");
    expect((await x.getCrossExitTriggers("KXBTCPERP"))[0].stop).toBe("8.2600");
  });
  it("does not verify a partial bracket when another fill grows exposure during readback", async () => {
    const x = new FakeExchange();
    const o = new PerpsOms(x, null, true, () => ({ ok: true, why: "test" }));
    const plan: ManagePlan = { dir: "long", qty: 3, entry: 8.36, stop: 8.26, t1: 8.46, t2: 8.66, partialFrac: 0.5, trailR: 1, maxHoldMs: 3600_000 };
    const entry = { ...i, plan, decisionId: "partial-growth-readback" };
    x.applyFill("partial-order", i.ticker, "bid", 1, i.price, true);
    await x.setCrossExitTrigger(i.ticker, { kind: "bracket", count: "1", stop_loss_price: "8.2600", take_profit_price: "8.6600" });
    const readTriggers = x.getCrossExitTriggers.bind(x);
    let reads = 0;
    x.getCrossExitTriggers = async (ticker: string) => {
      if (++reads === 2) x.applyFill("partial-order", ticker, "bid", 2, i.price, true);
      return readTriggers(ticker);
    };
    const result = await o.ensureAfterFill(entry, "partial-order");
    expect(result.state).toBe("PROTECTION_FAILED");
    expect(o.stateOf(clientOrderId(entry))).toBe("PROTECTION_FAILED");
    expect(o.blocked).toMatch(/unprotected entry/);
    expect(x.triggers).toHaveLength(1);
    expect((await o.submit({ ...i, decisionId: "entry-after-partial-growth" })).status).toMatch(/BLOCKED/);
  });
  for (const variant of ["short growth", "new bracket growth"] as const) {
    it(`rejects insufficient protection after ${variant}`, async () => {
      const x = new FakeExchange();
      const o = new PerpsOms(x, null, true, () => ({ ok: true, why: "test" }));
      const dir = variant === "short growth" ? "short" : "long";
      const side = dir === "short" ? "ask" : "bid";
      const stop = dir === "short" ? 8.46 : 8.26;
      const take = dir === "short" ? 8.06 : 8.66;
      const plan: ManagePlan = { dir, qty: 3, entry: 8.36, stop, t1: 8.36, t2: take, partialFrac: 0.5, trailR: 1, maxHoldMs: 3600_000 };
      const entry: Intent = { ...i, dir, plan, decisionId: variant };
      x.applyFill("growing-order", i.ticker, side, 1, i.price, true);
      if (variant === "short growth") {
        await x.setCrossExitTrigger(i.ticker, { kind: "bracket", count: "1", stop_loss_price: stop.toFixed(4), take_profit_price: take.toFixed(4) });
      }
      const readTriggers = x.getCrossExitTriggers.bind(x);
      let reads = 0;
      x.getCrossExitTriggers = async (ticker: string) => {
        if (++reads === 2) x.applyFill("growing-order", ticker, side, 2, i.price, true);
        return readTriggers(ticker);
      };
      expect((await o.ensureAfterFill(entry, "growing-order")).state).toBe("PROTECTION_FAILED");
      expect(o.stateOf(clientOrderId(entry))).toBe("PROTECTION_FAILED");
      expect(o.blocked).toMatch(/unprotected entry/);
      expect(x.triggers).toHaveLength(1);
      expect(x.orders).toHaveLength(0);
    });
  }
  it("fails closed when the second position read rejects", async () => {
    const x = new FakeExchange();
    const o = new PerpsOms(x, null, true, () => ({ ok: true, why: "test" }));
    const plan: ManagePlan = { dir: "long", qty: 3, entry: 8.36, stop: 8.26, t1: 8.46, t2: 8.66, partialFrac: 0.5, trailR: 1, maxHoldMs: 3600_000 };
    const entry = { ...i, plan, decisionId: "second-position-read-rejects" };
    x.applyFill("readback-order", i.ticker, "bid", 1, i.price, true);
    await x.setCrossExitTrigger(i.ticker, { kind: "bracket", count: "1", stop_loss_price: "8.2600", take_profit_price: "8.6600" });
    const positions = x.positions.bind(x);
    let reads = 0;
    x.positions = async () => {
      if (++reads === 2) throw new Error("simulated second read failure");
      return positions();
    };
    expect((await o.ensureAfterFill(entry, "readback-order")).state).toBe("PROTECTION_FAILED");
    expect(o.stateOf(clientOrderId(entry))).toBe("PROTECTION_FAILED");
    expect(o.blocked).toMatch(/simulated second read failure/);
    expect(x.triggers).toHaveLength(1);
    expect(x.orders).toHaveLength(0);
  });
  it("idempotent cid, duplicate refused, timeout → UNKNOWN → reconcile (no resend)", async () => {
    const x = new FakeExchange(); const o = new PerpsOms(x, null, true);
    expect(clientOrderId(i)).toBe(clientOrderId({ ...i })); x.failNextCreateAfterAccept = true;
    expect((await o.submit(i)).status).toMatch(/UNKNOWN/); expect((await o.submit(i)).status).toMatch(/DUPLICATE/); expect(x.orders.length).toBe(1);
    const r = await o.reconcile(0); expect(r.resolved.length).toBe(1);
  });
  it("refuses reversal; exits are reduce-only; unknown venue order blocks", async () => {
    const x = new FakeExchange(); const o = new PerpsOms(x, null, true); await o.submit(i);
    expect((await o.submit({ ...i, dir: "short", decisionId: "d2", plan: { ...i.plan!, dir: "short", stop: 8.46, t1: 8.26, t2: 8.06 } }, await x.positions())).status).toMatch(/reverse/);
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
  it("restart audit blocks a delayed partial fill without sending protection", async () => {
    const dir = mkdtempSync(join(tmpdir(), "perps-recovery-"));
    try {
      const x = new FakeExchange();
      const journal = join(dir, "journal.jsonl");
      const plan: ManagePlan = { dir: "long", qty: 3, entry: 8.36, stop: 8.26, t1: 8.46, t2: 8.66, partialFrac: 0.5, trailR: 1, maxHoldMs: 3600_000 };
      const entry: Intent = { ...i, maker: true, plan, decisionId: "restart-partial" };
      const first = new PerpsOms(x, journal, true, () => ({ ok: true, why: "test" }));
      const ack = await first.submit(entry);
      expect(ack.order_id).toBeTruthy();
      x.applyFill(ack.order_id!, i.ticker, "bid", 1, i.price, false);
      x.orders[0].fill_count = "1";
      x.orders[0].remaining_count = "2";
      x.triggers = [];
      const restarted = new PerpsOms(x, journal, false);
      const result = await restarted.recover(0);
      expect(result.blocked).not.toBeNull();
      expect(restarted.stateOf(clientOrderId(entry))).toBe("PROTECTION_FAILED");
      expect(x.orders).toHaveLength(1);
      expect(x.triggers).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("a successful read-only recovery audit cannot clear a persisted protection alarm", async () => {
    const dir = mkdtempSync(join(tmpdir(), "perps-alarm-"));
    try {
      const x = new FakeExchange();
      const journal = join(dir, "journal.jsonl");
      const plan: ManagePlan = { dir: "long", qty: 3, entry: 8.36, stop: 8.26, t1: 8.46, t2: 8.66, partialFrac: 0.5, trailR: 1, maxHoldMs: 3600_000 };
      const entry: Intent = { ...i, maker: true, plan, decisionId: "alarm-survives-audit" };
      const first = new PerpsOms(x, journal, true, () => ({ ok: true, why: "test" }));
      const ack = await first.submit(entry);
      x.applyFill(ack.order_id!, i.ticker, "bid", 1, i.price, false);
      x.orders[0].fill_count = "1";
      x.orders[0].remaining_count = "2";
      x.triggers = [];
      const audit = new PerpsOms(x, journal, false);
      await audit.recover(0);
      expect(audit.stateOf(clientOrderId(entry))).toBe("PROTECTION_FAILED");
      await x.setCrossExitTrigger(i.ticker, { kind: "bracket", count: "1", stop_loss_price: "8.2600", take_profit_price: "8.6600" });
      await audit.recover(0);
      const restarted = new PerpsOms(x, journal, false);
      expect(restarted.blocked).toMatch(/unprotected entry/);
      expect(restarted.stateOf(clientOrderId(entry))).toBe("PROTECTION_FAILED");
      expect(x.orders).toHaveLength(1);
      expect(x.triggers).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  const coveredRecovery = async () => {
    const x = new FakeExchange();
    const plan: ManagePlan = { dir: "long", qty: 3, entry: 8.36, stop: 8.26, t1: 8.46, t2: 8.66, partialFrac: 0.5, trailR: 1, maxHoldMs: 3600_000 };
    const entry: Intent = { ...i, maker: true, plan, decisionId: "covered-recovery" };
    const o = new PerpsOms(x, null, true, () => ({ ok: true, why: "test" }));
    const ack = await o.submit(entry);
    x.applyFill(ack.order_id!, i.ticker, "bid", 1, i.price, false);
    x.orders[0].fill_count = "1";
    x.orders[0].remaining_count = "2";
    return { x, o, entry, ack };
  };
  for (const changedRead of [2, 3]) {
    it(`recovery rejects growth after ownership read on position snapshot ${changedRead}`, async () => {
      const { x, o, ack } = await coveredRecovery();
      const positions = x.positions.bind(x);
      let reads = 0;
      x.positions = async () => {
        if (++reads === changedRead) x.applyFill(ack.order_id!, i.ticker, "bid", 2, i.price, false);
        return positions();
      };
      const result = await o.recover(0);
      expect(result.protection[0].state).toBe("PROTECTION_FAILED");
      expect(result.blocked).not.toBeNull();
      expect(x.orders).toHaveLength(1);
      expect(x.triggers).toHaveLength(1);
    });
  }
  it("repeated bracket snapshots neither prove lifecycle ownership nor write to venue", async () => {
    const { x, o, entry } = await coveredRecovery();
    let writes = 0;
    x.createOrder = async () => { writes++; throw new Error("unexpected entry"); };
    x.setCrossExitTrigger = async () => { writes++; throw new Error("unexpected protection write"); };
    const before = o.rows.length;
    for (let n = 0; n < 2; n++) {
      const result = await o.recover(0);
      expect(result.blocked).toMatch(/lifecycle unverified/);
      expect(result.protection[0].state).toBe("BRACKET_SNAPSHOT_VERIFIED");
      expect(o.stateOf(clientOrderId(entry))).toBe("ACK");
    }
    expect(o.rows).toHaveLength(before);
    expect(writes).toBe(0);
    expect(x.orders).toHaveLength(1);
    expect(x.triggers).toHaveLength(1);
  });
  for (const reason of ["missing plan", "second entry", "newer exit"] as const) {
    it(`recovery refuses ${reason} without venue writes`, async () => {
      const { x, o, entry } = await coveredRecovery();
      if (reason === "missing plan") delete o.rows.find((r) => r.intent)?.intent?.plan;
      else {
        const extra: Intent = { ...entry, kind: reason === "newer exit" ? "exit" : "entry", decisionId: reason };
        o.rows.push({ at: new Date().toISOString(), cid: clientOrderId(extra), state: "INTENT", intent: extra });
      }
      let writes = 0;
      x.createOrder = async () => { writes++; throw new Error("unexpected entry"); };
      x.setCrossExitTrigger = async () => { writes++; throw new Error("unexpected protection write"); };
      const result = await o.recover(0);
      expect(result.blocked).not.toBeNull();
      expect(result.protection[0].state).toBe("PROTECTION_FAILED");
      expect(writes).toBe(0);
      expect(x.orders).toHaveLength(1);
      expect(x.triggers).toHaveLength(1);
    });
  }
  for (const prior of ["KILL engaged", "unknown venue orders: prior"]) {
    it(`recovery preserves the existing in-memory ${prior} block`, async () => {
      const { o } = await coveredRecovery();
      o.blocked = prior;
      expect((await o.recover(0)).blocked).toBe(prior);
    });
  }
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
  it("macro surprise carries actual/forecast timestamps and ranks volatility only after detection", () => {
    const release = { name: "US CPI", assets: ["GOLD", "BTC"], actual: 3.1, consensus: 2.9, surpriseStd: 0.1,
      officialUrl: "https://www.bls.gov/", forecastUrl: "https://example.org/forecast",
      forecastAt: "2026-11-02T12:00:00Z", publishedAt: "2026-11-02T13:00:00Z", detectedAt: "2026-11-02T13:01:00Z" };
    const inputs = { calendar: null, intelEvents: [], mirofish: null, spark: null, evidence: [], macroReleases: [release] };
    const early = perpsIntel("KXGOLDPERP", Date.parse("2026-11-02T13:00:30Z"), inputs);
    const late = perpsIntel("KXGOLDPERP", Date.parse("2026-11-02T13:02:00Z"), inputs);
    expect(early.rows.find((r) => r.event === "US CPI")!.usable).toBe("LATE");
    expect(late.rows.find((r) => r.event === "US CPI")!.usable).toBe("PRE_DECISION");
    expect(late.rows.find((r) => r.event === "US CPI")!.score).toBeGreaterThan(0);
    expect(late.rows.find((r) => r.event === "US CPI")!.note).toContain("volatility catalyst only");
  });
  it("single-book YES+NO pair cannot be < $1 unless crossed", () => { expect(pairCost({ ticker: "t", yesBid: 0.5, noBid: 0.48 }, takerFee).status).toBe("NO_ARB"); });
  it("intel only uses items available before the decision", () => {
    const r = perpsIntel("KXXRPPERP", Date.parse("2026-10-09T12:00:00Z"), { calendar: null, intelEvents: [{ title: "x", assets: ["XRP"], publishedAt: "2026-10-09T06:00:00Z", detectedAt: "2026-10-10T00:00:00Z" }], mirofish: null, spark: null, evidence: [] });
    expect(r.rows.find((x) => x.event === "x")!.usable).toBe("LATE"); expect(Math.abs(r.intelScore)).toBe(0); expect(r.macroClear).toBe(false);
  });
});
