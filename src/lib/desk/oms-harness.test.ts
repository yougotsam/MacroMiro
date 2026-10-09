/**
 * 200 forced OMS scenarios against a MOCKED Kalshi (no network: global fetch is replaced with a thrower).
 * Faults: timeouts before/after the exchange accepts, 5xx before/after, 429, 4xx rejects, connection resets with
 * a lookup outage ("reconnect"), lagging order visibility, maker/taker partial fills, later fills, exchange-side
 * cancels and OMS cancels through a mock canceller. Invariants checked after every step:
 *   I1 the same client_order_id is never POSTed twice (and the mock never sees a duplicate)
 *   I2 every POST happens only after its intent row is in the journal
 *   I3 every order that exists on the exchange is either acknowledged in the journal or reserved as pending
 *   I4 the risk snapshot counts each exchange order exactly once: open + resting + pending
 *      = true exchange worst case + reserves for still-ambiguous sends that never reached the exchange
 *   I5 once lookups are healthy, every order created on the exchange is reconciled (found/acknowledged)
 *   I6 rejected sends never stay reserved
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { quadraticFee } from "./fees";
import { buildSnapshot, type KOrder } from "./kalshi-read";
import { Oms, kalshiOrderPost, type PostResult } from "./oms";
import { RiskEngine, type OrderIntent } from "./risk";

type Mode =
  | "ok_rest" | "ok_partial" | "ok_taker_full" | "ok_taker_partial" | "timeout_after" | "timeout_before"
  | "http500_after" | "http500_before" | "http429" | "reject400" | "reconnect" | "lag";
const MODES: Mode[] = ["ok_rest", "ok_partial", "ok_taker_full", "ok_taker_partial", "timeout_after", "timeout_before", "http500_after", "http500_before", "http429", "reject400", "reconnect", "lag"];
const ON = { live: () => true, begin: () => true, arm: () => true };
const COINS = ["KXBTC15M", "KXETH15M", "KXSOL15M", "KXXRP15M"];

class MockKalshi {
  orders = new Map<string, KOrder & { count: number; price: number; mode: "maker" | "taker" }>();
  posted: string[] = [];
  duplicates = 0;
  lookupDownFor = 0;
  hidden = new Map<string, number>(); // cid -> lookups remaining before visible
  next: Mode = "ok_rest";
  seq = 0;
  journalHadIntent = true;
  constructor(private journalHas: (cid: string) => boolean) {}

  private create(body: Record<string, unknown>, fill: number, status: string, remaining: number) {
    const cid = String(body.client_order_id);
    if (this.orders.has(cid)) {
      this.duplicates += 1;
      return null;
    }
    const isNo = body.side === "ask";
    const yes = Number(body.price);
    const count = Number(body.count);
    const mode = body.time_in_force === "immediate_or_cancel" ? "taker" : "maker";
    const ticker = String(body.ticker);
    const sidePx = isNo ? 1 - yes : yes;
    const o = {
      order_id: `oid-${++this.seq}`, client_order_id: cid, ticker, status, side: isNo ? "ask" : "bid",
      yes_price_dollars: yes.toFixed(4), no_price_dollars: (1 - yes).toFixed(4),
      fill_count_fp: fill.toFixed(2), remaining_count_fp: remaining.toFixed(2),
      taker_fees_dollars: mode === "taker" && fill > 0 ? quadraticFee(fill, sidePx).toFixed(4) : "0", maker_fees_dollars: "0",
      count, price: sidePx, mode: mode as "maker" | "taker",
    };
    this.orders.set(cid, o);
    return o;
  }

  transport = async (_path: string, body: Record<string, unknown>): Promise<PostResult> => {
    const cid = String(body.client_order_id);
    if (!this.journalHas(cid)) this.journalHadIntent = false;
    if (this.posted.includes(cid)) this.duplicates += 1;
    this.posted.push(cid);
    const count = Number(body.count);
    const taker = body.time_in_force === "immediate_or_cancel";
    const m = this.next;
    const ok = (o: KOrder | null) => ({ status: o ? 201 : 409, body: o ? { order_id: o.order_id, fill_count: o.fill_count_fp, remaining_count: o.remaining_count_fp } : {}, text: o ? "" : "duplicate" });
    switch (m) {
      case "ok_rest": return ok(this.create(body, 0, taker ? "canceled" : "resting", taker ? 0 : count));
      case "ok_partial": { const f = Math.max(1, count - 1); return ok(this.create(body, f, count - f > 0 && !taker ? "resting" : "executed", taker ? 0 : count - f)); }
      case "ok_taker_full": return ok(this.create(body, count, "executed", 0));
      case "ok_taker_partial": { const f = Math.max(1, Math.floor(count / 2)); return ok(this.create(body, f, "executed", 0)); }
      case "timeout_after": this.create(body, 0, taker ? "canceled" : "resting", taker ? 0 : count); throw new Error("The operation timed out.");
      case "timeout_before": throw new Error("The operation timed out.");
      case "http500_after": this.create(body, 0, taker ? "canceled" : "resting", taker ? 0 : count); return { status: 500, body: {}, text: "internal" };
      case "http500_before": return { status: 500, body: {}, text: "internal" };
      case "http429": return { status: 429, body: {}, text: "rate limited" };
      case "reject400": return { status: 400, body: {}, text: "invalid" };
      case "reconnect": this.create(body, 0, taker ? "canceled" : "resting", taker ? 0 : count); this.lookupDownFor = 4; throw new Error("socket hang up (ECONNRESET)");
      case "lag": this.create(body, 0, taker ? "canceled" : "resting", taker ? 0 : count); this.hidden.set(cid, 5); throw new Error("The operation timed out.");
    }
  };

  lookup = async (cids: string[]): Promise<KOrder[]> => {
    if (this.lookupDownFor > 0) {
      this.lookupDownFor -= 1;
      throw new Error("ECONNREFUSED (reconnecting)");
    }
    const out: KOrder[] = [];
    for (const c of cids) {
      const o = this.orders.get(c);
      if (!o) continue;
      const h = this.hidden.get(c) ?? 0;
      if (h > 0) { this.hidden.set(c, h - 1); continue; }
      out.push(o);
    }
    return out;
  };

  cancels = 0;
  canceller = async (path: string) => {
    const id = decodeURIComponent(path.split("/orders/")[1].split("?")[0]);
    const o = [...this.orders.values()].find((x) => x.order_id === id);
    if (!o || o.status !== "resting") return { status: 404 };
    o.status = "canceled";
    o.remaining_count_fp = "0.00";
    this.cancels += 1;
    return { status: 200 };
  };

  /** What Kalshi would report: today's orders and the resting list (hidden orders are not yet listed). */
  visible() {
    const all = [...this.orders.values()].filter((o) => !(this.hidden.get(o.client_order_id!) ?? 0));
    return { ordersToday: all, resting: all.filter((o) => o.status === "resting" && Number(o.remaining_count_fp) > 0) };
  }
  /** True worst case of everything on the exchange, with the snapshot's own fee policy. */
  trueWorst() {
    let w = 0;
    for (const o of this.orders.values()) {
      const fill = Number(o.fill_count_fp), left = o.status === "resting" ? Number(o.remaining_count_fp) : 0;
      w += fill * o.price + Number(o.taker_fees_dollars) + left * o.price + quadraticFee(left, o.price);
    }
    return w;
  }
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

let netCalls = 0;
const forbidNetwork = () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => {
    netCalls += 1;
    throw new Error("network forbidden in the OMS harness");
  }) as unknown as typeof fetch;
  return () => { globalThis.fetch = real; };
};

describe("OMS forced-scenario harness (mock Kalshi only)", () => {
  it("the release-gate override is refused with the real Kalshi transport or canceller", () => {
    const dir = mkdtempSync(join(tmpdir(), "omsh-guard-"));
    const risk = new RiskEngine(dir, ON);
    expect(() => new Oms(risk, kalshiOrderPost, async () => [], dir, { releaseGateForMockOnly: () => true, canceller: async () => ({ status: 200 }) })).toThrow();
    expect(() => new Oms(risk, async () => ({ status: 201, body: {}, text: "" }), async () => [], dir, { releaseGateForMockOnly: () => true })).toThrow();
  });

  it("200 scenarios: zero duplicate exposure and correct reconciliation", async () => {
    const restore = forbidNetwork();
    try {
    const counts = {
      scenarios: 0, submits: 0, riskRefused: 0, byMode: {} as Record<string, number>, exchangeOrders: 0, posts: 0,
      duplicatePosts: 0, postsWithoutIntent: 0, unreservedExposureEvents: 0, snapshotMismatches: 0,
      createdButUnreconciled: 0, ambiguousNeverCreatedStillReserved: 0, nextDayCarryoverMismatches: 0, rejectedStillReserved: 0,
      exchangeCancels: 0, omsCancels: 0, laterFills: 0, invariantChecks: 0,
    };
    for (let k = 0; k < 200; k += 1) {
      const r = rng(1000 + k);
      const dir = mkdtempSync(join(tmpdir(), `omsh-${k}-`));
      const risk = new RiskEngine(dir, ON);
      const ref: { oms?: Oms } = {};
      const mock = new MockKalshi((cid) => !!ref.oms && ref.oms.journal().some((j) => j.cid === cid && j.stage === "intent"));
      const oms = new Oms(risk, mock.transport, mock.lookup, dir, { releaseGateForMockOnly: () => true, canceller: mock.canceller, reconcileWaitMs: 0 });
      ref.oms = oms;
      const snapshot = () => {
        const v = mock.visible();
        const now = Date.now();
        return buildSnapshot({ now, settlements: [], positions: [], resting: v.resting, ordersToday: v.ordersToday, shard2Cash: 50, exchangeTradingActive: true, exchangeCheckedAt: now, pendingIntents: oms.pendingIntents(now), localOrdersPerTicker: oms.perTicker() });
      };
      const check = () => {
        counts.invariantChecks += 1;
        const last = new Map<string, string>();
        for (const j of oms.journal()) last.set(j.cid, j.stage);
        const pending = new Set(oms.pendingIntents().map((x) => x.cid));
        for (const o of mock.orders.values()) {
          const st = last.get(o.client_order_id!);
          const acknowledged = st === "sent" || st === "found" || st === "cancel";
          if (!acknowledged && !pending.has(o.client_order_id!)) counts.unreservedExposureEvents += 1;
        }
        // exactly-once accounting
        const s = snapshot();
        const reservedNotOnExchange = oms.pendingIntents().filter((p) => !mock.orders.has(p.cid) || (mock.hidden.get(p.cid) ?? 0) > 0)
          .reduce((a, p) => a + (mock.orders.has(p.cid) ? 0 : p.worst), 0);
        const hiddenWorst = [...mock.orders.values()].filter((o) => (mock.hidden.get(o.client_order_id!) ?? 0) > 0)
          .reduce((a, o) => a + (pending.has(o.client_order_id!) ? oms.pendingIntents().find((p) => p.cid === o.client_order_id)!.worst : 0), 0);
        const visibleTrue = mock.trueWorst() - [...mock.orders.values()].filter((o) => (mock.hidden.get(o.client_order_id!) ?? 0) > 0)
          .reduce((a, o) => a + Number(o.fill_count_fp) * o.price + (o.status === "resting" ? Number(o.remaining_count_fp) * o.price + quadraticFee(Number(o.remaining_count_fp), o.price) : 0), 0);
        const expected = visibleTrue + reservedNotOnExchange + hiddenWorst;
        if (Math.abs(s.openWorst + s.restWorst + s.pendingWorst - expected) > 1e-3) counts.snapshotMismatches += 1;
      };
      const n = 1 + Math.floor(r() * 4);
      for (let i = 0; i < n; i += 1) {
        const mode = MODES[Math.floor(r() * MODES.length)];
        mock.next = mode;
        counts.byMode[mode] = (counts.byMode[mode] ?? 0) + 1;
        const coin = COINS[Math.floor(r() * COINS.length)];
        const taker = mode.startsWith("ok_taker") || r() < 0.3;
        const intent: OrderIntent = {
          product: "event", ticker: `${coin}-26OCT0812${String(15 * (i % 4)).padStart(2, "0")}-00`, side: r() < 0.5 ? "yes" : "no",
          mode: taker ? "taker" : "maker", price: Number((0.2 + Math.floor(r() * 40) / 100).toFixed(2)), count: 1 + Math.floor(r() * 3), fee: 0, tickId: k * 10 + i,
        };
        if (intent.mode === "taker") intent.fee = quadraticFee(intent.count, intent.price);
        counts.submits += 1;
        const res = await oms.submit(intent, snapshot());
        if (!res.cid && res.why.startsWith("risk")) counts.riskRefused += 1;
        check();
        // exchange/OMS events between ticks
        const resting = [...mock.orders.values()].filter((o) => o.status === "resting");
        for (const o of resting) {
          const roll = r();
          if (roll < 0.2) { o.status = "canceled"; o.remaining_count_fp = "0.00"; counts.exchangeCancels += 1; }
          else if (roll < 0.4) {
            const left = Number(o.remaining_count_fp);
            o.fill_count_fp = (Number(o.fill_count_fp) + 1).toFixed(2);
            o.remaining_count_fp = (left - 1).toFixed(2);
            if (left - 1 <= 0) o.status = "executed";
            counts.laterFills += 1;
          } else if (roll < 0.55 && (oms.journal().some((j) => j.cid === o.client_order_id && (j.stage === "sent" || j.stage === "found")))) {
            const st = await oms.cancel(o.order_id, o.ticker, o.client_order_id!, "harness cancel");
            if (st === 200) counts.omsCancels += 1;
          }
        }
        check();
        await oms.reconcilePending();
        check();
      }
      // let any outage/lag heal, then reconcile
      for (let t = 0; t < 10; t += 1) {
        await oms.reconcilePending();
        check();
      }
      const last = new Map<string, string>();
      for (const j of oms.journal()) last.set(j.cid, j.stage);
      const pending = new Set(oms.pendingIntents().map((x) => x.cid));
      for (const o of mock.orders.values()) if (!["sent", "found", "cancel"].includes(last.get(o.client_order_id!) ?? "")) counts.createdButUnreconciled += 1;
      for (const [cid, st] of last) {
        if (st === "rejected" && pending.has(cid)) counts.rejectedStillReserved += 1;
        if (!mock.orders.has(cid) && pending.has(cid)) counts.ambiguousNeverCreatedStillReserved += 1;
      }
      // I7 next ET day: yesterday's orders are no longer listed and their contracts settled; only sends that never
      // reached the exchange (still ambiguous) may stay reserved (review B1 — no phantom carry-over).
      const tomorrow = Date.now() + 36 * 3600_000;
      const nd = buildSnapshot({ now: tomorrow, settlements: [], positions: [], resting: [], ordersToday: [], shard2Cash: 50, exchangeTradingActive: true, exchangeCheckedAt: tomorrow, pendingIntents: oms.pendingIntents(tomorrow) });
      const ambiguousReserve = oms.pendingIntents(tomorrow).filter((p) => !mock.orders.has(p.cid)).reduce((a, p) => a + p.worst, 0);
      if (Math.abs(nd.pendingWorst - ambiguousReserve) > 1e-6) counts.nextDayCarryoverMismatches += 1;
      counts.exchangeOrders += mock.orders.size;
      counts.posts += mock.posted.length;
      counts.duplicatePosts += mock.duplicates;
      if (!mock.journalHadIntent) counts.postsWithoutIntent += 1;
      counts.scenarios += 1;
    }
    writeFileSync(join(tmpdir(), "oms-harness-results.json"), JSON.stringify({ ...counts, networkCalls: netCalls }, null, 1));
    console.log("OMS harness:", JSON.stringify({ ...counts, networkCalls: netCalls }));
    expect(counts.scenarios).toBe(200);
    expect(counts.duplicatePosts).toBe(0);
    expect(counts.postsWithoutIntent).toBe(0);
    expect(counts.unreservedExposureEvents).toBe(0);
    expect(counts.snapshotMismatches).toBe(0);
    expect(counts.createdButUnreconciled).toBe(0);
    expect(counts.rejectedStillReserved).toBe(0);
    expect(counts.nextDayCarryoverMismatches).toBe(0);
    expect(netCalls).toBe(0);
    for (const m of MODES) expect(counts.byMode[m] ?? 0).toBeGreaterThan(0);
    } finally {
      restore();
    }
  }, { timeout: 120_000 });
});
