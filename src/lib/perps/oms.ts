/**
 * Kalshi perps order manager. `PERPS_ORDERS_LOCKED` in `order-adapter.ts` is false.
 * `lockedTransport` still throws on every write. A live send has to pass a real transport
 * and `allowSend`. `POST /api/live/perp-fire` does that when the three desk switches are on.
 * The 15-minute engine does not construct this class.
 * Field names follow docs.kalshi.com perps_openapi.yaml (CreateMarginOrderRequest, MarginOrder, MarginFill,
 * MarginPosition, SetCrossExitTriggerRequest). Verified rules:
 *  - client_order_id, side (bid|ask), count, price, time_in_force, self_trade_prevention_type are required.
 *  - post_only, reduce_only, cancel_order_on_pause, order_group_id, subaccount are optional.
 *  - GET /margin/orders filters: ticker, min_ts, max_ts, status, limit, cursor (no client_order_id filter).
 *  - Help Center: you cannot close a position while a resting order is active, so cancel the remainder first.
 * Safety mechanics: deterministic idempotent client IDs, journal written BEFORE send, never auto-resend after an
 * uncertain result (reconcile by listing orders), duplicate-intent refusal, unknown-order detection (blocks new
 * entries), restart recovery from exchange positions/orders, kill = cancel-all + reduce-only IOC flatten, and
 * entries refused if they would oppose an open position (never reverse).
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { nativeTriggerRequests, type ManagePlan } from "./manage";
import { watchdogFresh } from "@/lib/loop/watchdog";

export { PERPS_ORDERS_LOCKED, PerpsOrdersLocked } from "./order-adapter";
import { PERPS_ORDERS_LOCKED, PerpsOrdersLocked } from "./order-adapter";

export type CreateReq = {
  ticker: string; client_order_id: string; side: "bid" | "ask"; count: string; price: string;
  time_in_force: "fill_or_kill" | "good_till_canceled" | "immediate_or_cancel"; self_trade_prevention_type: "taker_at_cross" | "maker";
  post_only?: boolean; reduce_only?: boolean; cancel_order_on_pause?: boolean; order_group_id?: string; subaccount?: number;
};
export type VenueOrder = { order_id: string; client_order_id: string; ticker: string; side: "bid" | "ask"; price: string; fill_count: string; remaining_count: string; last_update_reason?: string };
export type VenueFill = { fill_id: string; order_id: string; is_taker: boolean; side: "bid" | "ask"; count: string; price: string; fees: string; realized_pnl: string; ticker: string; created_time: string };
export type VenuePosition = { market_ticker: string; position: string; entry_price: string; unrealized_pnl: string; fees: string };
export interface PerpsTransport {
  createOrder(r: CreateReq): Promise<{ order_id: string; client_order_id?: string; fill_count: string; remaining_count: string; average_fill_price?: string; average_fee_paid?: string }>;
  cancelOrder(orderId: string): Promise<void>;
  cancelAll(): Promise<void>;
  listOrders(q: { ticker?: string; min_ts?: number; status?: string }): Promise<VenueOrder[]>;
  fills(q: { min_ts?: number }): Promise<VenueFill[]>;
  positions(): Promise<VenuePosition[]>;
  setCrossExitTrigger(ticker: string, body: Record<string, unknown>): Promise<{ id: string }>;
  updateCrossExitTrigger(ticker: string, id: string, body: Record<string, unknown>): Promise<{ id: string }>;
}
/** The only transport wired to the real venue path. Every method refuses. */
export const lockedTransport: PerpsTransport = {
  createOrder: async () => { throw new PerpsOrdersLocked("createOrder"); },
  cancelOrder: async () => { throw new PerpsOrdersLocked("cancelOrder"); },
  cancelAll: async () => { throw new PerpsOrdersLocked("cancelAll"); },
  listOrders: async () => { throw new PerpsOrdersLocked("listOrders (needs portfolio read wiring)"); },
  fills: async () => { throw new PerpsOrdersLocked("fills"); },
  positions: async () => { throw new PerpsOrdersLocked("positions"); },
  setCrossExitTrigger: async () => { throw new PerpsOrdersLocked("setCrossExitTrigger"); },
  updateCrossExitTrigger: async () => { throw new PerpsOrdersLocked("updateCrossExitTrigger"); },
};

export type Intent = { kind: "entry" | "exit" | "flatten"; ticker: string; dir: "long" | "short"; qty: number; price: number; maker: boolean; plan?: ManagePlan; decisionId: string };
export type JournalRow = { at: string; cid: string; state: "INTENT" | "SENT" | "ACK" | "UNKNOWN" | "RECONCILED" | "REJECTED" | "CANCELED"; intent?: Intent; order_id?: string; note?: string };

export const CID_PREFIX = "mm-perps-";
/** Same intent → same client_order_id, so a retry can never create a second order. */
export function clientOrderId(i: Intent) { return CID_PREFIX + createHash("sha256").update(`${i.decisionId}|${i.kind}|${i.ticker}|${i.dir}|${i.qty}|${i.price}`).digest("hex").slice(0, 24); }

export function toCreateReq(i: Intent): CreateReq {
  const reduce = i.kind !== "entry";
  const side = (i.dir === "long") === (i.kind === "entry") ? "bid" : "ask"; // exits/flatten trade the opposite way
  return {
    ticker: i.ticker, client_order_id: clientOrderId(i), side, count: String(i.qty), price: i.price.toFixed(4),
    time_in_force: i.maker ? "good_till_canceled" : "immediate_or_cancel", self_trade_prevention_type: "taker_at_cross",
    post_only: i.maker || undefined, reduce_only: reduce || undefined, cancel_order_on_pause: true,
  };
}

export class PerpsOms {
  rows: JournalRow[] = [];
  blocked: string | null = null;
  constructor(private t: PerpsTransport, private journalPath: string | null = null, private allowSend = !PERPS_ORDERS_LOCKED, private watchdog: () => { ok: boolean; why: string } = () => watchdogFresh()) {
    if (journalPath && existsSync(journalPath)) {
      try { this.rows = readFileSync(journalPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
      catch { this.blocked = "corrupt journal: sending disabled"; }
    }
  }
  private log(r: Omit<JournalRow, "at">) { const row = { at: new Date().toISOString(), ...r }; this.rows.push(row); if (this.journalPath) appendFileSync(this.journalPath, JSON.stringify(row) + "\n"); }
  stateOf(cid: string) { return this.rows.filter((r) => r.cid === cid).at(-1)?.state ?? null; }

  /** Place an intent once. Refuses duplicates, reversals, unknown-order blocks and the global lock. */
  async submit(i: Intent, positions: VenuePosition[] = []): Promise<{ cid: string; status: string; order_id?: string }> {
    const cid = clientOrderId(i);
    if (this.blocked) return { cid, status: `BLOCKED: ${this.blocked}` };
    if (this.stateOf(cid)) return { cid, status: `DUPLICATE (${this.stateOf(cid)}): not re-sent` };
    const pos = Number(positions.find((p) => p.market_ticker === i.ticker)?.position ?? 0);
    if (i.kind === "entry") { const wd = this.watchdog(); if (!wd.ok) return { cid, status: `REFUSED: ${wd.why} (fail-closed, entries only)` }; }
    if (i.kind === "entry" && pos !== 0 && (pos > 0) !== (i.dir === "long")) return { cid, status: "REFUSED: would reverse an open position" };
    if (i.kind !== "entry" && i.qty > Math.abs(pos)) i = { ...i, qty: Math.abs(pos) };
    const req = toCreateReq(i);
    this.log({ cid, state: "INTENT", intent: i });
    if (!this.allowSend) { this.log({ cid, state: "REJECTED", note: "PERPS_ORDERS_LOCKED" }); return { cid, status: "LOCKED: not sent" }; }
    this.log({ cid, state: "SENT" });
    try {
      const r = await this.t.createOrder(req);
      this.log({ cid, state: "ACK", order_id: r.order_id, note: `filled ${r.fill_count} remaining ${r.remaining_count}` });
      if (i.kind === "entry" && i.plan) for (const body of nativeTriggerRequests(i.plan, r.order_id, cid)) await this.t.setCrossExitTrigger(i.ticker, body);
      return { cid, status: "ACK", order_id: r.order_id };
    } catch (e) {
      // network/timeout/5xx: the order may or may not exist. Never resend; reconcile instead.
      this.log({ cid, state: "UNKNOWN", note: String((e as Error).message).slice(0, 200) });
      return { cid, status: "UNKNOWN: will reconcile, not resend" };
    }
  }

  /** Resolve UNKNOWN/SENT rows by listing venue orders; flag venue orders with our prefix that we never journaled. */
  async reconcile(sinceMs: number) {
    const venue = await this.t.listOrders({ min_ts: Math.floor(sinceMs / 1000) });
    const ours = new Map(venue.map((o) => [o.client_order_id, o]));
    const out: { resolved: string[]; missing: string[]; unknownVenueOrders: string[] } = { resolved: [], missing: [], unknownVenueOrders: [] };
    const cids = [...new Set(this.rows.map((r) => r.cid))];
    for (const cid of cids) {
      const st = this.stateOf(cid);
      if (st !== "UNKNOWN" && st !== "SENT") continue;
      const v = ours.get(cid);
      if (v) { this.log({ cid, state: "RECONCILED", order_id: v.order_id, note: `venue fill ${v.fill_count} rem ${v.remaining_count}` }); out.resolved.push(cid); }
      else { this.log({ cid, state: "CANCELED", note: "not found at venue after reconcile; treated as never placed (not resent)" }); out.missing.push(cid); }
    }
    for (const o of venue) if (!cids.includes(o.client_order_id)) out.unknownVenueOrders.push(`${o.order_id}/${o.client_order_id || "no-cid"}`);
    if (out.unknownVenueOrders.length) this.blocked = `unknown venue orders: ${out.unknownVenueOrders.join(",")}`;
    return out;
  }

  /** Restart recovery: rebuild exposure from the exchange, not from memory. */
  async recover(sinceMs: number) {
    const [positions, rec] = [await this.t.positions(), await this.reconcile(sinceMs)];
    const unmanaged = positions.filter((p) => Number(p.position) !== 0 && !this.rows.some((r) => r.intent?.ticker === p.market_ticker));
    if (unmanaged.length) this.blocked = `unmanaged positions: ${unmanaged.map((p) => p.market_ticker).join(",")}`;
    return { positions, ...rec, unmanaged: unmanaged.map((p) => p.market_ticker), blocked: this.blocked };
  }

  /** Kill: cancel every resting order (needed before a close), then flatten each position with reduce-only IOC. */
  async killAndFlatten(operatorToken: string, expectedToken: string, books: Record<string, { bestBid: number | null; bestAsk: number | null }>, decisionId: string) {
    if (!operatorToken || operatorToken !== expectedToken) return { ok: false, why: "unauthenticated kill request" };
    this.blocked = "KILL engaged";
    await this.t.cancelAll();
    const out: string[] = [];
    for (const p of await this.t.positions()) {
      const q = Number(p.position); if (!q) continue;
      const b = books[p.market_ticker]; const long = q > 0;
      const px = long ? b?.bestBid : b?.bestAsk; if (px == null) { out.push(`${p.market_ticker}: no book, cannot flatten`); continue; }
      const i: Intent = { kind: "flatten", ticker: p.market_ticker, dir: long ? "long" : "short", qty: Math.abs(q), price: long ? px * 0.98 : px * 1.02, maker: false, decisionId };
      const req = toCreateReq(i); const cid = req.client_order_id;
      this.log({ cid, state: "INTENT", intent: i });
      try { const r = await this.t.createOrder(req); this.log({ cid, state: "ACK", order_id: r.order_id }); out.push(`${p.market_ticker}: flatten sent ${req.side} ${req.count} reduce_only`); }
      catch (e) { this.log({ cid, state: "UNKNOWN", note: String((e as Error).message) }); out.push(`${p.market_ticker}: flatten UNKNOWN`); }
    }
    return { ok: true, actions: out };
  }

  /** Realized P&L and fees from venue fills (MarginFill.realized_pnl and .fees), filtered to our orders. */
  static pnlFromFills(fills: VenueFill[], orderIds: Set<string>) {
    const f = fills.filter((x) => orderIds.has(x.order_id));
    return { fills: f.length, realizedUsd: +f.reduce((s, x) => s + Number(x.realized_pnl), 0).toFixed(6), feesUsd: +f.reduce((s, x) => s + Number(x.fees), 0).toFixed(6), makerFills: f.filter((x) => !x.is_taker).length };
  }
}

/** In-memory exchange used by tests and the reconciliation demo. Not a venue; no network. */
export class FakeExchange implements PerpsTransport {
  orders: (VenueOrder & { reduce_only?: boolean })[] = []; fillsList: VenueFill[] = []; pos = new Map<string, { q: number; e: number }>(); triggers: { ticker: string; body: Record<string, unknown> }[] = [];
  failNextCreateAfterAccept = false; n = 0;
  async createOrder(r: CreateReq) {
    if (this.orders.some((o) => o.client_order_id === r.client_order_id)) throw new Error("409 duplicate client_order_id");
    const id = `ord-${++this.n}`; const qty = Number(r.count);
    const cur = this.pos.get(r.ticker) ?? { q: 0, e: 0 };
    let fill = r.post_only ? 0 : qty;
    if (r.reduce_only) fill = Math.min(fill, Math.abs(cur.q));
    this.orders.push({ order_id: id, client_order_id: r.client_order_id, ticker: r.ticker, side: r.side, price: r.price, fill_count: String(fill), remaining_count: String(r.post_only ? qty : 0), reduce_only: r.reduce_only });
    if (fill) this.applyFill(id, r.ticker, r.side, fill, Number(r.price), true);
    if (this.failNextCreateAfterAccept) { this.failNextCreateAfterAccept = false; throw new Error("timeout after accept"); }
    return { order_id: id, client_order_id: r.client_order_id, fill_count: String(fill), remaining_count: String(r.post_only ? qty : 0) };
  }
  applyFill(orderId: string, ticker: string, side: "bid" | "ask", qty: number, px: number, taker: boolean, fee = taker ? 0.0012 : 0.0002) {
    const cur = this.pos.get(ticker) ?? { q: 0, e: 0 }; const sgn = side === "bid" ? 1 : -1; let realized = 0;
    if (cur.q !== 0 && Math.sign(cur.q) !== sgn) { const c = Math.min(Math.abs(cur.q), qty); realized = (px - cur.e) * c * Math.sign(cur.q); cur.q += sgn * c; }
    else { cur.e = (cur.e * Math.abs(cur.q) + px * qty) / (Math.abs(cur.q) + qty); cur.q += sgn * qty; }
    this.pos.set(ticker, cur);
    this.fillsList.push({ fill_id: `f-${this.fillsList.length + 1}`, order_id: orderId, is_taker: taker, side, count: String(qty), price: String(px), fees: (qty * px * fee).toFixed(6), realized_pnl: realized.toFixed(6), ticker, created_time: new Date().toISOString() });
  }
  async cancelOrder(id: string) { const o = this.orders.find((x) => x.order_id === id); if (o) o.remaining_count = "0"; }
  async cancelAll() { for (const o of this.orders) o.remaining_count = "0"; }
  async listOrders() { return this.orders.map((o) => ({ ...o })); }
  async fills() { return [...this.fillsList]; }
  async positions() { return [...this.pos.entries()].map(([t, p]) => ({ market_ticker: t, position: String(p.q), entry_price: String(p.e), unrealized_pnl: "0", fees: "0" })); }
  async setCrossExitTrigger(ticker: string, body: Record<string, unknown>) { this.triggers.push({ ticker, body }); return { id: `trg-${this.triggers.length}` }; }
  async updateCrossExitTrigger(ticker: string, id: string, body: Record<string, unknown>) { this.triggers.push({ ticker, body: { ...body, id } }); return { id }; }
}
