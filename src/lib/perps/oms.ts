/**
 * Kalshi perps order manager; real dispatch requires transport capability and allowSend.
 * lockedTransport refuses writes; /api/live/perp-fire remains independently hard-blocked.
 * Intended serialized routing is never credential authorization or lifecycle ownership.
 * The 15-minute engine does not construct this class.
 * Field names follow docs.kalshi.com perps_openapi.yaml (CreateMarginOrderRequest, MarginOrder, MarginFill,
 * MarginPosition, SetCrossExitTriggerRequest). Verified rules:
 *  - client_order_id, side (bid|ask), count, price, time_in_force, self_trade_prevention_type are required.
 *  - post_only, reduce_only, cancel_order_on_pause, order_group_id, subaccount are optional.
 *  - GET /margin/orders filters: ticker, min_ts, max_ts, status, limit, cursor (no client_order_id filter).
 *  - Help Center: you cannot close a position while a resting order is active, so cancel the remainder first.
 * Safety mechanics: deterministic idempotent client IDs, journal written BEFORE send, never auto-resend after an
 * uncertain result (reconcile by listing orders), duplicate-intent refusal, unknown-order detection (blocks new
 * entries), restart recovery from exchange positions/orders, legacy kill = cancel-all + reduce-only IOC flatten; scoped kill stays closed, and
 * entries refused if they would oppose an open position (never reverse).
 */
import { scopedTransport, scopedClientOrderId, scopedBracketCovers, scopedUnits, type CrossScope, type PreparedCreate, type Request } from "./cross-account";
import { copySnapshotJson } from "./scoped-snapshot";
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
export type ExitTrigger = { id: string; kind: string; status: string | null; stop: string | null; take: string | null; count: string | null; trail: string | null; filled_count?: string };
export interface PerpsTransport {
  createOrder(r: CreateReq): Promise<{ order_id: string; client_order_id?: string; fill_count: string; remaining_count: string; average_fill_price?: string; average_fee_paid?: string }>;
  cancelOrder(orderId: string): Promise<void>;
  cancelAll(): Promise<void>;
  listOrders(q: { ticker?: string; min_ts?: number; status?: string }): Promise<VenueOrder[]>;
  fills(q: { min_ts?: number }): Promise<VenueFill[]>;
  positions(): Promise<VenuePosition[]>;
  setCrossExitTrigger(ticker: string, body: Record<string, unknown>): Promise<{ id: string }>;
  updateCrossExitTrigger(ticker: string, id: string, body: Record<string, unknown>): Promise<{ id: string }>;
  /** Live brackets and the trailing stop on one ticker. Empty means Kalshi returned none. */
  getCrossExitTriggers(ticker: string): Promise<ExitTrigger[]>;
  /** Clears every exit trigger on the ticker. A ticker with none still succeeds. */
  cancelCrossExitTriggers(ticker: string): Promise<void>;
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
  getCrossExitTriggers: async () => { throw new PerpsOrdersLocked("getCrossExitTriggers"); },
  cancelCrossExitTriggers: async () => { throw new PerpsOrdersLocked("cancelCrossExitTriggers"); },
};

export type Intent = { kind: "entry" | "exit" | "flatten"; ticker: string; dir: "long" | "short"; qty: number; price: number; maker: boolean; plan?: ManagePlan; decisionId: string };
export type JournalRow = { at: string; cid: string; state: "INTENT" | "SENT" | "ACK" | "PROTECTION_FAILED" | "PROTECTION_VERIFIED" | "UNKNOWN" | "RECONCILED" | "REJECTED" | "CANCELED"; intent?: Intent; order_id?: string; note?: string; intendedRouting?: CrossScope; serializedRequest?: PreparedCreate; protectionRequest?: Request };

export const CID_PREFIX = "mm-perps-";
/** Same legacy intent → same identifier; not an exactly-once venue guarantee. */
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

function captureIntent(input: Intent): Intent {
  if (!input || typeof input !== "object" || Object.getPrototypeOf(input) !== Object.prototype) throw new Error("invalid scoped intent");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Object.values(descriptors).some(d => !("value" in d))) throw new Error("intent accessor refused");
  const i = copySnapshotJson(Object.fromEntries(Object.entries(descriptors).filter(([,d]) => d.value !== undefined).map(([k,d]) => [k,d.value]))) as Intent;
  if (!["entry", "exit", "flatten"].includes(i.kind) || !["long", "short"].includes(i.dir) || typeof i.maker !== "boolean" ||
      typeof i.ticker !== "string" || !i.ticker.trim() || i.ticker === "." || i.ticker === ".." || typeof i.decisionId !== "string" || !i.decisionId.trim() ||
      !Number.isFinite(i.qty) || !Number.isFinite(i.price) || i.qty <= 0 || i.price <= 0) throw new Error("invalid scoped intent fields");
  scopedUnits(String(i.qty), 2);
  if (i.plan) {
    if (i.plan.dir !== i.dir || Object.entries(i.plan).some(([k,v]) => k !== "dir" && (typeof v !== "number" || !Number.isFinite(v))) ||
        ![i.plan.qty,i.plan.entry,i.plan.stop,i.plan.t1,i.plan.t2,i.plan.partialFrac,i.plan.trailR,i.plan.maxHoldMs].every(v=>typeof v === "number" && Number.isFinite(v)) ||
        i.plan.qty <= 0 || i.plan.entry <= 0 || i.plan.stop <= 0 || i.plan.t1 <= 0 || i.plan.t2 <= 0) throw new Error("invalid scoped plan");
  }
  return i;
}

export class PerpsOms {
  rows: JournalRow[] = [];
  private serial: Promise<unknown> = Promise.resolve();
  private reserved = new Set<string>();
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.serial.then(work, work); this.serial = next.catch(() => undefined); return next;
  }
  blocked: string | null = null;
  constructor(private t: PerpsTransport, private journalPath: string | null = null, private allowSend = !PERPS_ORDERS_LOCKED, private watchdog: () => { ok: boolean; why: string } = () => watchdogFresh()) {
    if (journalPath && existsSync(journalPath)) {
      try { this.rows = readFileSync(journalPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
      catch { this.blocked = "corrupt journal: sending disabled"; }
      // A new HTTP request must not reset a prior unprotected-entry alarm.
      if (!this.blocked && !scopedTransport(this.t)) {
        const latest = new Map<string, JournalRow>();
        for (const r of this.rows) latest.set(r.cid, r);
        if ([...latest.values()].some((r) => r.state === "PROTECTION_FAILED")) {
          this.blocked = "unprotected entry in journal: reconcile position and triggers before new entries";
        }
      }
    }
    if (scopedTransport(this.t)) {
      if (this.rows.some(row => !row || typeof row !== "object" || typeof row.cid !== "string" || typeof row.state !== "string")) {
        this.blocked ??= "invalid scoped journal row"; this.t.forgetIntendedOrders(); return;
      }
      let routeValid = true;
      if (this.rows.some((row) => row.state === "PROTECTION_FAILED")) this.blocked ??= "durable scoped protection failure";
      try {
      for (const row of this.rows) {
        if (!this.scopeMatches(row)) { routeValid = false; this.blocked ??= "unowned legacy or conflicting scoped journal"; continue; }
        if (this.rows.filter((r) => r.cid === row.cid && r.state === "INTENT" && r.intent).length !== 1) {
          routeValid = false; this.blocked ??= "ambiguous scoped journal intent";
        }
        if (row.state === "INTENT" && row.intent) {
          const savedIntent = captureIntent(row.intent);
          const expected = this.prepare(this.request(savedIntent));
          if (row.cid !== this.identity(row.intent) || !row.serializedRequest ||
              row.serializedRequest.url !== expected?.url || row.serializedRequest.body !== expected?.body ||
              row.serializedRequest.method !== "POST") { routeValid = false; this.blocked ??= "invalid intended serialized routing"; }
        }
      }
      const associations = new Map<string,string>(), orders = new Map<string,string>();
      for (const row of this.rows) if (row.order_id) {
        if ((associations.has(row.cid) && associations.get(row.cid) !== row.order_id) || (orders.has(row.order_id) && orders.get(row.order_id) !== row.cid)) {
          routeValid = false; this.blocked ??= "ambiguous scoped associations";
        }
        associations.set(row.cid,row.order_id); orders.set(row.order_id,row.cid);
      }
      } catch { routeValid = false; this.blocked ??= "invalid scoped journal intent or association"; }
      if (this.rows.length) this.blocked ??= "scoped lifecycle requires reconciliation";
      if (!routeValid) this.t.forgetIntendedOrders();
      if (routeValid) for (const row of this.rows) if (row.order_id &&
          this.rows.some((i) => i.cid === row.cid && i.state === "INTENT" && i.intent)) {
        try { this.t.rememberIntendedOrder(row.order_id, row.cid); } catch { this.blocked ??= "ambiguous restored association"; }
      }
    }
  }
  private scopeMatches(row: JournalRow) {
    if (!scopedTransport(this.t)) return true;
    const a = row.intendedRouting, b = this.t.scope;
    return !!a && a.origin === b.origin && a.subaccount === b.subaccount && a.subaccount_type === b.subaccount_type;
  }
  private identity(i: Intent) { return scopedTransport(this.t) ? scopedClientOrderId(this.t.scope, i) : clientOrderId(i); }
  private request(i: Intent) {
    const req = toCreateReq(i);
    return scopedTransport(this.t) ? { ...req, client_order_id: this.identity(i), subaccount: this.t.scope.subaccount } : req;
  }
  private prepare(req: CreateReq) { return scopedTransport(this.t) ? this.t.prepareCreate(req) : undefined; }
  private dispatch(req: CreateReq, prepared?: PreparedCreate) {
    if (scopedTransport(this.t)) {
      if (!prepared) throw new Error("scoped prepared request missing");
      if (!this.allowSend || !this.t.writeAvailable || !this.journalPath) throw new Error("scoped dispatch permission closed");
      if (!req.reduce_only && this.blocked) throw new Error("entry blocked at dispatch");
      return this.t.dispatchCreate(prepared);
    }
    return this.t.createOrder(req);
  }
  private log(r: Omit<JournalRow, "at">) {
    const row: JournalRow = { ...r, at: new Date().toISOString(),
      ...(scopedTransport(this.t) ? { intendedRouting: this.t.scope } : {}) };
    if (scopedTransport(this.t)) {
      try { if (this.journalPath) appendFileSync(this.journalPath, JSON.stringify(row) + "\n"); }
      catch (error) { this.blocked ??= "scoped journal persistence failure"; throw error; }
      this.rows.push(Object.freeze(row));
    } else {
      this.rows.push(row);
      if (this.journalPath) appendFileSync(this.journalPath, JSON.stringify(row) + "\n");
    }
  }
  /** Persistent fault visible to every later OMS instance sharing this journal. */
  latchProtectionFault(why: string) {
    this.blocked = `unmanaged or unprotected venue exposure: ${why.slice(0, 160)}`;
    this.log({ cid: `${CID_PREFIX}guardian`, state: "PROTECTION_FAILED", note: why.slice(0, 200) });
  }
  stateOf(cid: string) { return this.rows.filter((r) => r.cid === cid).at(-1)?.state ?? null; }

  /** Place an intent once. Refuses duplicates, reversals, unknown-order blocks and the global lock. */
  async submit(i: Intent, positions: VenuePosition[] = []): Promise<{ cid: string; status: string; order_id?: string }> {
    if (!scopedTransport(this.t)) return this.submitCaptured(i, positions);
    const captured = captureIntent(i), cid = this.identity(captured);
    if (this.reserved.has(cid)) return { cid, status: "DUPLICATE (reserved): not re-sent" };
    this.reserved.add(cid);
    try { return await this.enqueue(() => this.submitCaptured(captured, [])); }
    finally { this.reserved.delete(cid); }
  }
  private async submitCaptured(i: Intent, positions: VenuePosition[]): Promise<{ cid: string; status: string; order_id?: string }> {
    let cid = this.identity(i);
    // Faults block NEW exposure, not protective reduce-only exits.
    if (this.blocked && i.kind === "entry") return { cid, status: `BLOCKED: ${this.blocked}` };
    // Hard OMS law: no entry may be sent without an attached native protective exit plan.
    if (i.kind === "entry") {
      const p = i.plan;
      const stopOk = p != null && Number.isFinite(p.stop) && Number.isFinite(p.t2) &&
        Number.isFinite(p.entry) && Number.isFinite(p.qty) && p.qty === i.qty &&
        p.qty > 0 && p.maxHoldMs > 0 && Number.isFinite(p.maxHoldMs) &&
        p.dir === i.dir && Math.abs(p.entry - i.price) <= 0.00011 &&
        (i.dir === "long" ? p.stop < i.price && p.t2 > i.price : p.stop > i.price && p.t2 < i.price);
      if (!stopOk) return { cid, status: "REFUSED: native stop, target, size, entry and maximum hold must be valid before sending" };
    }
    if (this.stateOf(cid)) return { cid, status: `DUPLICATE (${this.stateOf(cid)}): not re-sent` };
    if (scopedTransport(this.t)) {
      if (!this.allowSend || !this.t.writeAvailable || !this.journalPath) {
        const req = this.request(i), prepared = this.prepare(req);
        this.log({ cid, state: "INTENT", intent: i, serializedRequest: prepared });
        this.log({ cid, state: "REJECTED", note: "scoped sends disabled" });
        return { cid, status: "LOCKED: not sent" };
      }
      positions = await this.t.positions();
      if (i.kind === "entry" && this.blocked) return { cid, status: `BLOCKED: ${this.blocked}` };
      if (!this.allowSend || !this.t.writeAvailable || !this.journalPath) return { cid, status: "LOCKED: not sent" };
    }
    const pos = Number(positions.find((p) => p.market_ticker === i.ticker)?.position ?? 0);
    if (i.kind === "entry") { const wd = this.watchdog(); if (!wd.ok) return { cid, status: `REFUSED: ${wd.why} (fail-closed, entries only)` }; }
    if (i.kind === "entry" && pos !== 0 && (pos > 0) !== (i.dir === "long")) return { cid, status: "REFUSED: would reverse an open position" };
    if (i.kind !== "entry" && i.qty > Math.abs(pos)) i = { ...i, qty: Math.abs(pos) };
    if (scopedTransport(this.t) && i.kind !== "entry") {
      if (pos === 0) return { cid, status: "NO_POSITION: not sent" };
      cid = this.identity(i); // identity follows the actual capped serialized intent, scoped path only
      if (this.stateOf(cid)) return { cid, status: `DUPLICATE (${this.stateOf(cid)}): not re-sent` };
    }
    const req = this.request(i);
    const prepared = this.prepare(req);
    this.log({ cid, state: "INTENT", intent: i, ...(prepared ? { serializedRequest: prepared } : {}) });
    if (!this.allowSend) { this.log({ cid, state: "REJECTED", note: "PERPS_ORDERS_LOCKED" }); return { cid, status: "LOCKED: not sent" }; }
    this.log({ cid, state: "SENT" });
    try {
      const r = await this.dispatch(req, prepared);
      if (scopedTransport(this.t)) this.t.rememberIntendedOrder(r.order_id, cid);
      this.log({ cid, state: "ACK", order_id: r.order_id, note: `filled ${r.fill_count} remaining ${r.remaining_count}` });
      if (i.kind === "entry" && i.plan) {
        const notes: string[] = [];
        let failedProtection = false;
        for (const body of nativeTriggerRequests(i.plan, r.order_id, cid, pos !== 0)) {
          try {
            const trg = await this.protect(i, r.order_id, body);
            notes.push(trg.id);
          } catch (e) {
            failedProtection = true;
            notes.push(`failed ${String((e as Error).message).slice(0, 120)}`);
          }
        }
        if (failedProtection) {
          // The entry may already have filled. Never claim it is protected or re-send it.
          // Reconcile with venue orders, fills, positions and triggers before further entries.
          this.log({ cid, state: "PROTECTION_FAILED", order_id: r.order_id, note: `triggers ${notes.join(",")}` });
          this.blocked = `unprotected entry ${cid}: operator reconciliation required`;
          return { cid, status: "PROTECTION_FAILED: entry may be open without a stop; reconcile immediately", order_id: r.order_id };
        }
        if (notes.length) this.log({ cid, state: "ACK", order_id: r.order_id, note: `triggers ${notes.join(",")}` });
        // Immediate/taker fills are verified in the same operation. Resting maker
        // fills require the user-fills worker to call ensureAfterFill on notification.
        if (Number(r.fill_count) > 0) {
          const protectedFill = await this.ensureCaptured(i, r.order_id);
          if (protectedFill.state !== "PROTECTION_VERIFIED") {
            return { cid, status: `${protectedFill.state}: ${protectedFill.why}`, order_id: r.order_id };
          }
        }
      }
      return { cid, status: "ACK", order_id: r.order_id };
    } catch (e) {
      // network/timeout/5xx: the order may or may not exist. Never resend; reconcile instead.
      if (scopedTransport(this.t)) this.blocked ??= "unknown scoped dispatch; reconcile before new entries";
      this.log({ cid, state: "UNKNOWN", note: String((e as Error).message).slice(0, 200) });
      return { cid, status: "UNKNOWN: will reconcile, not resend" };
    }
  }

  /**
   * Verify or attach protective stop/target AFTER an actual venue fill.
   * Trigger acceptance during order ACK is not evidence that the filled position
   * is protected. This method requires the venue's live position and trigger list.
   * Caller is a dedicated fill/recovery worker, never an unverified browser POST.
   */
  private association(i: Intent, orderId: string) {
    const cid = this.identity(i);
    if (scopedTransport(this.t) && !this.t.intendedAssociation(orderId,cid)) return false;
    if (!this.journalPath) return false;
    try {
      const durable = readFileSync(this.journalPath,"utf8").split("\n").filter(Boolean).map(line=>JSON.parse(line));
      if (JSON.stringify(durable) !== JSON.stringify(this.rows)) { this.blocked ??= "scoped durable journal mismatch"; return false; }
    } catch { this.blocked ??= "scoped durable journal unavailable"; return false; }
    const intents = this.rows.filter(r => r.cid === cid && r.state === "INTENT");
    const expected = this.prepare(this.request(i));
    return !!this.journalPath && intents.length === 1 &&
      intents[0]!.serializedRequest?.body === expected?.body && intents[0]!.serializedRequest?.url === expected?.url &&
      intents[0]!.serializedRequest?.method === "POST" && this.rows.filter(r=>r.cid === cid).every(r=>this.scopeMatches(r)) && this.scopeMatches(intents[0]!) &&
      JSON.stringify(intents[0]!.intent) === JSON.stringify(i) && !!intents[0]!.serializedRequest &&
      this.rows.some(r => r.cid === cid && r.order_id === orderId && r.state === "ACK") &&
      !this.rows.some(r => (r.cid === cid && r.order_id && r.order_id !== orderId) || (r.order_id === orderId && r.cid !== cid));
  }
  private async protect(i: Intent, orderId: string, body: Record<string,unknown>) {
    if (!scopedTransport(this.t)) return this.t.setCrossExitTrigger(i.ticker, body);
    if (!this.allowSend || !this.t.writeAvailable || !this.association(i,orderId)) throw new Error("unassociated or disabled scoped protection");
    const prepared = this.t.prepareProtection(i.ticker,body,{orderId,cid:this.identity(i)});
    this.log({cid:this.identity(i),state:"SENT",order_id:orderId,note:"intended protection request",protectionRequest:prepared});
    if (!this.allowSend || !this.t.writeAvailable || !this.association(i,orderId)) throw new Error("scoped protection permission closed");
    return this.t.dispatchProtection(prepared);
  }
  async ensureAfterFill(i: Intent, orderId: string, expectedPosition?: number | string): Promise<{ state: "WAITING_FOR_FILL" | "PROTECTION_VERIFIED" | "PROTECTION_FAILED"; why: string }> {
    if (!scopedTransport(this.t)) return this.ensureCaptured(i,orderId,expectedPosition);
    const captured = captureIntent(i);
    return this.enqueue(() => this.ensureCaptured(captured,orderId,expectedPosition));
  }
  private async ensureCaptured(i: Intent, orderId: string, expectedPosition?: number | string, auditOnly = false): Promise<{ state: "WAITING_FOR_FILL" | "PROTECTION_VERIFIED" | "PROTECTION_FAILED"; why: string }> {
    if (scopedTransport(this.t) && !this.association(i,orderId)) return {state:"PROTECTION_FAILED",why:"scoped journal intent/order association required"};
    if (i.kind !== "entry" || !i.plan || !orderId) {
      return { state: "PROTECTION_FAILED", why: "entry plan or order id missing" };
    }
    const cid = this.identity(i);
    const fail = (why: string) => {
      if (auditOnly && scopedTransport(this.t)) return { state: "PROTECTION_FAILED" as const, why };
      if (scopedTransport(this.t)) this.blocked ??= `unprotected entry ${cid}: ${why.slice(0,150)}`;
      this.log({ cid, state: "PROTECTION_FAILED", order_id: orderId, note: why.slice(0, 200) });
      this.blocked = (scopedTransport(this.t) ? this.blocked : null) ?? `unprotected entry ${cid}: ${why.slice(0, 150)}`;
      return { state: "PROTECTION_FAILED" as const, why };
    };
    try {
      const positions = await this.t.positions();
      const positionText = positions.find((p) => p.market_ticker === i.ticker)?.position ?? "0";
      const pos = Number(positionText);
      if (!Number.isFinite(pos)) return fail("position quantity invalid");
      if (expectedPosition !== undefined && (scopedTransport(this.t)
        ? scopedUnits(positionText, 2) !== scopedUnits(String(expectedPosition), 2) : pos !== Number(expectedPosition))) {
        return fail("position changed since ownership audit");
      }
      if (pos === 0) return { state: "WAITING_FOR_FILL", why: "exchange shows no open filled position" };
      if ((pos > 0) !== (i.dir === "long")) return fail("position is opposite the entry direction");
      const stop = i.plan.stop.toFixed(4), take = i.plan.t2.toFixed(4);
      const hasProtection = (triggers: ExitTrigger[], quantity = Math.abs(pos), exactPosition = positionText) =>
        triggers.some((t) => scopedTransport(this.t) ? scopedBracketCovers(t, stop, take, exactPosition) : t.kind === "bracket" && t.status === "active" &&
          t.stop != null && t.take != null &&
          Number(t.stop) === Number(stop) && Number(t.take) === Number(take) &&
          t.count != null && (Number(t.count) === 0 ||
            ((!scopedTransport(this.t) || Number(t.filled_count) === 0) && Number(t.count) >= quantity)));
      const before = await this.t.getCrossExitTriggers(i.ticker);
      if (!hasProtection(before)) {
        if (!this.allowSend || auditOnly) return fail("protective trigger absent, sending disabled");
        if (before.length) return fail("other exit triggers already exist; refuse overlapping brackets");
        await this.protect(i, orderId, {
          kind: "bracket", count: String(Math.abs(pos)),
          client_trigger_id: `${cid}-filled`.slice(0, 64),
          stop_loss_price: stop, take_profit_price: take,
        });
      }
      const confirmed = await this.t.getCrossExitTriggers(i.ticker);
      const currentPositions = await this.t.positions();
      const currentText = currentPositions.find((p) => p.market_ticker === i.ticker)?.position ?? "0";
      const currentPos = Number(currentText);
      if (!Number.isFinite(currentPos) || currentPos === 0 ||
          (currentPos > 0) !== (i.dir === "long")) {
        return fail("position changed during protection readback; reconcile again");
      }
      if (expectedPosition !== undefined && (scopedTransport(this.t)
        ? scopedUnits(currentText, 2) !== scopedUnits(String(expectedPosition), 2) : currentPos !== Number(expectedPosition))) {
        return fail("position changed during ownership/protection audit");
      }
      if (!hasProtection(confirmed, Math.abs(currentPos), currentText)) {
        return fail("venue did not confirm stop and target covering current position");
      }
      if (!auditOnly && (!scopedTransport(this.t) || !this.rows.some((r) => r.cid === cid && r.state === "PROTECTION_FAILED")) &&
        (this.stateOf(cid) !== "PROTECTION_VERIFIED" || !hasProtection(before))) this.log({ cid, state: "PROTECTION_VERIFIED", order_id: orderId, note: `venue stop ${stop} target ${take}, open ${currentPos}` });
      if (!scopedTransport(this.t) && this.blocked?.includes(cid)) this.blocked = null;
      return { state: "PROTECTION_VERIFIED", why: "venue readback confirmed" };
    } catch (err) {
      return fail(String((err as Error).message).slice(0, 180));
    }
  }

  /** Resolve UNKNOWN/SENT rows by listing venue orders; flag venue orders with our prefix that we never journaled. */
  async reconcile(sinceMs: number) {
    const venue = await this.t.listOrders({ min_ts: Math.floor(sinceMs / 1000) });
    const ours = new Map(venue.map((o) => [o.client_order_id, o]));
    const out: { resolved: string[]; missing: string[]; unknownVenueOrders: string[] } = { resolved: [], missing: [], unknownVenueOrders: [] };
    const cids = [...new Set(this.rows.map((r) => r.cid))];
    for (const cid of cids) {
      if (scopedTransport(this.t) && this.rows.filter((r) => r.cid === cid).some((r) => !this.scopeMatches(r))) {
        this.blocked ??= "unowned scoped journal history";
        out.missing.push(cid); continue;
      }
      const st = this.stateOf(cid);
      if (st !== "UNKNOWN" && st !== "SENT") continue;
      const v = ours.get(cid);
      if (v) { this.log({ cid, state: "RECONCILED", order_id: v.order_id, note: `venue fill ${v.fill_count} rem ${v.remaining_count}` }); out.resolved.push(cid); }
      else if (scopedTransport(this.t)) {
        this.log({ cid, state: "UNKNOWN", note: "absent from requested history; not proof of cancellation" });
        this.blocked ??= "unknown scoped order history"; out.missing.push(cid);
      }
      else { this.log({ cid, state: "CANCELED", note: "not found at venue after reconcile; treated as never placed (not resent)" }); out.missing.push(cid); }
    }
    for (const o of venue) if (!cids.includes(o.client_order_id)) out.unknownVenueOrders.push(`${o.order_id}/${o.client_order_id || "no-cid"}`);
    if (out.unknownVenueOrders.length) this.blocked = (scopedTransport(this.t) ? this.blocked : null) ?? `unknown venue orders: ${out.unknownVenueOrders.join(",")}`;
    return out;
  }

  /** Restart audit only: never repairs triggers or grants order permission. */
  async recover(sinceMs: number) {
    const previousBlock = this.blocked;
    const protection: { ticker: string; state: "BRACKET_SNAPSHOT_VERIFIED" | "PROTECTION_FAILED"; why: string }[] = [];
    const reserveBlock = (why: string) => {
      // Never clear a prior KILL, corruption, unknown-order or protection alarm.
      this.blocked = previousBlock ?? this.blocked ?? why;
    };
    try {
      const rec = await this.reconcile(sinceMs);
      const positions = await this.t.positions();
      const venue = await this.t.listOrders({ min_ts: Math.floor(sinceMs / 1000) });
      const unmanaged: string[] = [];
      for (const position of positions) {
        const ticker = position.market_ticker;
        const qty = Number(position.position);
        if (qty === 0) continue;
        const reject = (why: string) => {
          unmanaged.push(ticker);
          protection.push({ ticker, state: "PROTECTION_FAILED", why });
          reserveBlock(`unmanaged positions: ${ticker}: ${why}`);
        };
        if (!Number.isFinite(qty)) {
          reject("invalid position quantity");
          continue;
        }
        // Do not guess among entries/exits, old lifecycles or multiple plans.
        const intents = this.rows.filter((r) => r.state === "INTENT" && r.intent?.ticker === ticker);
        if (intents.length !== 1) {
          reject("missing or ambiguous journal ownership");
          continue;
        }
        const row = intents[0];
        const intent = row.intent!;
        const plan = intent.plan;
        if (intent.kind !== "entry" || row.cid !== this.identity(intent) || !this.scopeMatches(row) || !plan ||
            plan.dir !== intent.dir || plan.qty !== intent.qty || plan.entry !== intent.price ||
            ![intent.qty, intent.price, plan.stop, plan.t2].every((n) => Number.isFinite(n) && n > 0) ||
            (qty > 0) !== (intent.dir === "long") ||
            !(intent.dir === "long" ? plan.stop < intent.price && plan.t2 > intent.price
              : plan.stop > intent.price && plan.t2 < intent.price)) {
          reject("invalid entry identity, direction or protection plan");
          continue;
        }
        const orderIds = [...new Set(this.rows.filter((r) => r.cid === row.cid && r.order_id).map((r) => r.order_id!))];
        const orders = venue.filter((o) => o.ticker === ticker);
        const order = orders[0];
        if (orderIds.length !== 1 || orders.length !== 1 || order.order_id !== orderIds[0] ||
            order.client_order_id !== row.cid || order.side !== (intent.dir === "long" ? "bid" : "ask") ||
            (scopedTransport(this.t) ? scopedUnits(order.price, 6) !== scopedUnits(intent.price.toFixed(4), 6)
              : Number(order.price) !== Number(intent.price.toFixed(4))) ||
            (scopedTransport(this.t) ? scopedUnits(order.fill_count, 2) !== (scopedUnits(position.position, 2) < 0n ? -scopedUnits(position.position, 2) : scopedUnits(position.position, 2))
              : Number(order.fill_count) !== Math.abs(qty)) || !(Number(order.fill_count) > 0) ||
            Number(order.fill_count) > intent.qty || !Number.isFinite(Number(order.remaining_count)) ||
            Number(order.remaining_count) < 0 || (scopedTransport(this.t) ? scopedUnits(order.fill_count, 2) + scopedUnits(order.remaining_count, 2) > scopedUnits(String(intent.qty), 2)
              : Number(order.fill_count) + Number(order.remaining_count) > intent.qty)) {
          reject("venue order does not uniquely explain current exposure");
          continue;
        }
        // Reuse protection readback with writes disabled, in an isolated journal.
        const verifier = new PerpsOms(this.t, null, false);
        const result = scopedTransport(this.t) ? await this.ensureCaptured(captureIntent(intent), order.order_id, position.position, true)
          : await verifier.ensureAfterFill(intent, order.order_id, qty);
        const state = result.state === "PROTECTION_VERIFIED" ? "PROTECTION_VERIFIED" as const : "PROTECTION_FAILED" as const;
        // A read-only audit is not explicit clearance of a persisted alarm.
        // Do not replace its latest journal state with a successful snapshot.
        if (state === "PROTECTION_FAILED") {
          this.log({ cid: row.cid, state, order_id: order.order_id, note: `recovery audit: ${result.why}` });
        }
        if (state === "PROTECTION_FAILED") {
          protection.push({ ticker, state, why: result.why });
          reserveBlock(`recovery protection: ${ticker}: ${result.why}`);
        } else {
          // Tuple matching and truncated history cannot prove a position lifecycle.
          protection.push({ ticker, state: "BRACKET_SNAPSHOT_VERIFIED",
            why: "bracket covers audited exposure; position lifecycle ownership remains unverified" });
          reserveBlock(`ownership lifecycle unverified: ${ticker}`);
        }
      }
      if (previousBlock) this.blocked = previousBlock;
      return { positions, ...rec, unmanaged, protection, blocked: this.blocked };
    } catch {
      reserveBlock("recovery read failed; exposure/protection not verified");
      throw new Error("recovery read failed; exposure/protection not verified");
    }
  }

  /** Kill: cancel every resting order (needed before a close), then flatten each position with reduce-only IOC. */
  async killAndFlatten(operatorToken: string, expectedToken: string, books: Record<string, { bestBid: number | null; bestAsk: number | null }>, decisionId: string) {
    if (!operatorToken || operatorToken !== expectedToken) return { ok: false, why: "unauthenticated kill request" };
    if (scopedTransport(this.t)) {
      this.blocked = "KILL engaged: bulk killAndFlatten closed pending lifecycle ownership";
      return { ok: false, why: this.blocked };
    }
    this.blocked = "KILL engaged";
    const tickers = new Set<string>();
    try {
      for (const o of await this.t.listOrders({})) if (o.ticker) tickers.add(o.ticker);
      for (const p of await this.t.positions()) if (Number(p.position) !== 0) tickers.add(p.market_ticker);
      for (const t of tickers) await this.t.cancelCrossExitTriggers(t);
    } catch (e) {
      if (scopedTransport(this.t)) throw new Error("scoped kill audit failed; no fallback cancellation/flatten");
      this.log({ cid: `kill-${decisionId}`, state: "UNKNOWN", note: `trigger cancel ${String((e as Error).message).slice(0, 160)}` });
    }
    await this.t.cancelAll();
    const out: string[] = [];
    for (const p of await this.t.positions()) {
      const q = Number(p.position); if (!q) continue;
      const b = books[p.market_ticker]; const long = q > 0;
      const px = long ? b?.bestBid : b?.bestAsk; if (px == null) { out.push(`${p.market_ticker}: no book, cannot flatten`); continue; }
      const i: Intent = { kind: "flatten", ticker: p.market_ticker, dir: long ? "long" : "short", qty: Math.abs(q), price: long ? px * 0.98 : px * 1.02, maker: false, decisionId };
      const req = this.request(i); const cid = req.client_order_id;
      const prepared = this.prepare(req);
      this.log({ cid, state: "INTENT", intent: i, ...(prepared ? { serializedRequest: prepared } : {}) });
      if (scopedTransport(this.t)) this.log({ cid, state: "SENT" });
      try { const r = await this.dispatch(req, prepared); this.log({ cid, state: "ACK", order_id: r.order_id }); out.push(`${p.market_ticker}: flatten sent ${req.side} ${req.count} reduce_only`); }
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
  async getCrossExitTriggers(ticker: string) {
    return this.triggers.filter((t) => t.ticker === ticker).map((t, ix) => ({
      id: String(t.body.id ?? `trg-${ix + 1}`), kind: String(t.body.kind ?? "bracket"),
      status: (this.pos.get(ticker)?.q ?? 0) !== 0 ? "active" : "pending_on_entry",
      stop: t.body.stop_loss_price == null ? null : String(t.body.stop_loss_price),
      take: t.body.take_profit_price == null ? null : String(t.body.take_profit_price),
      count: t.body.count == null ? "0" : String(t.body.count),
      trail: t.body.trail_amount == null ? null : String(t.body.trail_amount),
    }));
  }
  async cancelCrossExitTriggers() { this.triggers.length = 0; }
}
