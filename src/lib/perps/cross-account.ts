/** Generic explicit routing; configured/request scope is NEVER credential or lifecycle proof. */
import { createHash } from "node:crypto";
import type { CreateReq, Intent, PerpsTransport, ExitTrigger } from "./oms";
import { copySnapshotJson } from "./scoped-snapshot";
import { readAccountRequestEvidence } from "./request-evidence";
import { mapMarginOrder, mapMarginFill, mapMarginPosition, mapExitTrigger, readMarginArray, readMarginHistory, qs } from "./margin-wire";
export type CrossScope = Readonly<{ origin: string; subaccount: number; subaccount_type: "cross" }>;
export type Request = Readonly<{ url: string; method: "GET" | "POST" | "PUT" | "DELETE"; body?: string }>;
export type PreparedCreate = Request & Readonly<{ method: "POST"; body: string }>;
export type Reply = { status: number; body: unknown };
export type ReadIO = (request: Request & { method: "GET" }) => Promise<Reply>;
export type WriteIO = (request: Request) => Promise<Reply>;
export interface ScopedCrossTransport extends PerpsTransport {
  readonly routingKind: "explicit-cross-v2";
  readonly scope: CrossScope;
  readonly writeAvailable: boolean;
  prepareCreate(request: CreateReq): PreparedCreate;
  dispatchCreate(request: PreparedCreate): ReturnType<PerpsTransport["createOrder"]>;
  rememberIntendedOrder(orderId: string, cid: string): void;
  forgetIntendedOrders(): void;
  intendedAssociation(orderId: string, cid: string): boolean;
  prepareProtection(ticker: string, body: Record<string, unknown>, association: Readonly<{ orderId: string; cid: string }>): Request;
  dispatchProtection(request: Request): Promise<{ id: string }>;
  readEvidence(tickers: readonly string[]): ReturnType<typeof readAccountRequestEvidence>;
}
const constructed = new WeakSet<object>();
export function scopedTransport(t: PerpsTransport): t is ScopedCrossTransport {
  return constructed.has(t);
}
export function scopedClientOrderId(scope: CrossScope, i: Intent) {
  return "mm-perps-v2-" + createHash("sha256").update(JSON.stringify([
    scope.origin, scope.subaccount, scope.subaccount_type,
    i.decisionId, i.kind, i.ticker, i.dir, i.qty, i.price,
  ])).digest("hex").slice(0, 24);
}
const object = (x: unknown): Record<string, unknown> => {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("malformed scoped response");
  return x as Record<string, unknown>;
};
const nonblank = (x: unknown): x is string => typeof x === "string" && !!x.trim();
const decimal = (x: unknown, places: number, signed = false) => {
  if (typeof x !== "string" || !(new RegExp(`^${signed ? "-?" : ""}[0-9]+(?:[.][0-9]{1,${places}})?$`)).test(x)) return false;
  const [whole, fraction = ""] = x.replace(/^-/, "").split(".");
  return BigInt(whole! + fraction.padEnd(places, "0")) <= BigInt(Number.MAX_SAFE_INTEGER);
};
/** Exact representation only, no risk policy or inferred lifecycle ownership. */
export function scopedUnits(text: string, places: number): bigint {
  if (!decimal(text, places, true)) throw new Error("invalid scoped fixed point");
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  const units = BigInt(whole! + fraction.padEnd(places, "0"));
  return negative ? -units : units;
}
export function scopedBracketCovers(t: ExitTrigger, stop: string, take: string, position: string): boolean {
  try {
    const quantity = scopedUnits(position, 2);
    const count = scopedUnits(t.count ?? "", 2);
    return t.kind === "bracket" && t.status === "active" &&
      scopedUnits(t.stop ?? "", 6) === scopedUnits(stop, 6) &&
      scopedUnits(t.take ?? "", 6) === scopedUnits(take, 6) &&
      (count === 0n || (scopedUnits(t.filled_count ?? "", 2) === 0n && count >= (quantity < 0n ? -quantity : quantity)));
  } catch { return false; }
}
export function createCrossAccountTransport(input: CrossScope, io: { read: ReadIO; write?: WriteIO }): ScopedCrossTransport {
  const copied = copySnapshotJson(input) as CrossScope;
  const scope: CrossScope = Object.freeze({ origin: copied.origin, subaccount: copied.subaccount, subaccount_type: copied.subaccount_type });
  const origin = new URL(scope.origin);
  if (origin.origin !== scope.origin || !["https:", "http:"].includes(origin.protocol) ||
      scope.subaccount_type !== "cross" || !Number.isSafeInteger(scope.subaccount) || scope.subaccount < 0) throw new Error("invalid explicit cross scope");
  const orders = "/trade-api/v2/margin/orders", fills = "/trade-api/v2/margin/fills", positions = "/trade-api/v2/margin/positions";
  const readIO = io.read, writeIO = io.write; // Capture capabilities; later caller mutation cannot activate writes.
  const issued = new WeakSet<object>();
  const known = new Map<string, string>();
  const ambiguous = new Set<string>();
  const ambiguousOrders = new Set<string>();
  const poison = (cid: string, ...ids: string[]) => {
    ambiguous.add(cid);
    for (const [id, c] of known) if (c === cid) ambiguousOrders.add(id);
    for (const id of ids) ambiguousOrders.add(id);
  };
  const protectionIssued = new WeakMap<object, Readonly<{ orderId: string; cid: string }>>();
  const path = (base: string, extra: Record<string, string | number | undefined> = {}) => base + qs({ ...extra, subaccount: scope.subaccount });
  const trigger = (ticker: string, id?: string) => {
    if (!nonblank(ticker) || ticker === "." || ticker === ".." || (id !== undefined && (!nonblank(id) || id === "." || id === ".."))) throw new Error("invalid scoped path segment");
    return path(`/trade-api/v2/margin/cross/positions/${encodeURIComponent(ticker)}/exit_trigger${id === undefined ? "" : "/" + encodeURIComponent(id)}`);
  };
  const get = async (p: string) => {
    const url = new URL(scope.origin + p);
    if (url.origin !== scope.origin || url.pathname + url.search !== p) throw new Error("scoped read route mismatch");
    const reply = await readIO(Object.freeze({ url: url.href, method: "GET" }));
    return { status: reply.status, body: copySnapshotJson(reply.body) };
  };
  const history = (p: string, field: "orders" | "fills") => readMarginHistory(p, field, get);
  const array = (p: string, field: "positions" | "exit_triggers") => readMarginArray(p, field, get);
  const write = async (request: Request) => {
    if (!writeIO) throw new Error("scoped writes unavailable");
    const url = new URL(request.url);
    if (url.origin !== scope.origin) throw new Error("scoped write origin mismatch");
    const reply = await writeIO(request);
    if (![200, 201, 204].includes(reply.status)) throw new Error(`scoped write http ${reply.status}`);
    return reply;
  };
  // All history parsing, semantic validation, mapping and consumer association checks
  // share one fail-closed boundary. Omitted account/type is not a contradiction.
  const orderHistory = async <T>(q: { ticker?: string; min_ts?: number; status?: string }, consume: (rows: Record<string,unknown>[]) => T): Promise<T> => {
    try {
      const rows = (await history(path(orders, { ...q, limit: 1000 }), "orders")).map(object);
      const cids = new Set<string>();
      for (const row of rows) {
        if (typeof row.client_order_id === "string" && cids.has(row.client_order_id)) poison(row.client_order_id,...rows.filter(r=>r.client_order_id===row.client_order_id).map(r=>String(r.order_id)));
        if (!nonblank(row.order_id) || row.order_id === "." || row.order_id === ".." || !nonblank(row.client_order_id) ||
            !nonblank(row.ticker) || row.ticker === "." || row.ticker === ".." || row.order_source !== "user" ||
            (row.user_id !== undefined && !nonblank(row.user_id)) ||
            !decimal(row.fill_count, 2) || !decimal(row.remaining_count, 2) || !decimal(row.price, 6, true) ||
            cids.has(row.client_order_id) || (row.subaccount !== undefined && row.subaccount !== scope.subaccount) ||
            (row.subaccount_type !== undefined && row.subaccount_type !== "cross")) throw new Error("ambiguous scoped order history: unverified facts");
        mapMarginOrder(row); // Includes immutable side validation, inside this same catch.
        cids.add(row.client_order_id);
      }
      return consume(rows);
    } catch (error) {
      // ANY rejected history/association cannot certify which known mapping remains usable.
      for (const [id,cid] of known) poison(cid,id);
      throw error;
    }
  };
  const triggerBody = (body: Record<string, unknown>) => {
    if (Object.hasOwn(body, "subaccount") || Object.hasOwn(body, "subaccount_type")) throw new Error("trigger account belongs in scoped query only");
    if (body.count !== undefined && (!decimal(body.count, 2) || !Number.isInteger(Number(body.count)))) throw new Error("trigger count must be whole contracts");
    return JSON.stringify(copySnapshotJson(body));
  };
  const transport: ScopedCrossTransport = {
    routingKind: "explicit-cross-v2", scope, writeAvailable: !!writeIO,
    prepareCreate(req) {
      if (!nonblank(req.ticker) || req.ticker === "." || req.ticker === ".." || !decimal(req.count, 2) || scopedUnits(req.count, 2) <= 0n || !decimal(req.price, 6) || scopedUnits(req.price, 6) <= 0n ||
          !["bid", "ask"].includes(req.side) || !["fill_or_kill", "good_till_canceled", "immediate_or_cancel"].includes(req.time_in_force) ||
          !["taker_at_cross", "maker"].includes(req.self_trade_prevention_type) ||
          [req.post_only, req.reduce_only, req.cancel_order_on_pause].some(v => v !== undefined && typeof v !== "boolean") ||
          (req.order_group_id !== undefined && !nonblank(req.order_group_id))) throw new Error("malformed scoped create fields");
      if (req.subaccount !== undefined && req.subaccount !== scope.subaccount) throw new Error("create account mismatch");
      if (req.reduce_only && !["immediate_or_cancel", "fill_or_kill"].includes(req.time_in_force)) throw new Error("unsupported reduce-only TIF; not rewritten");
      if (!/^mm-perps-v2-[a-f0-9]{24}$/.test(req.client_order_id)) throw new Error("scoped CID required");
      const body = JSON.stringify(copySnapshotJson(Object.fromEntries(Object.entries({ ...req, subaccount: scope.subaccount }).filter(([, v]) => v !== undefined))));
      const prepared: PreparedCreate = Object.freeze({ url: scope.origin + orders, method: "POST", body });
      issued.add(prepared);
      return prepared;
    },
    async dispatchCreate(prepared) {
      if (!writeIO) throw new Error("scoped writes unavailable");
      if (!issued.has(prepared) || prepared.url !== scope.origin + orders || prepared.method !== "POST" ||
          object(JSON.parse(prepared.body)).subaccount !== scope.subaccount) throw new Error("unissued or mismatched create request");
      issued.delete(prepared);
      const reply = await write(prepared);
      const body = object(reply.body);
      if (!nonblank(body.order_id) || !decimal(body.fill_count, 2) || !decimal(body.remaining_count, 2)) throw new Error("malformed scoped create ACK");
      const requestBody = object(JSON.parse(prepared.body));
      const cid = String(requestBody.client_order_id);
      for (const [key, value] of Object.entries({ client_order_id: cid, subaccount: scope.subaccount, subaccount_type: "cross", ticker: requestBody.ticker, side: requestBody.side })) {
        if (Object.hasOwn(body, key) && body[key] !== value) throw new Error("contradictory scoped create ACK");
      }
      if (scopedUnits(String(body.fill_count), 2) + scopedUnits(String(body.remaining_count), 2) > scopedUnits(String(requestBody.count), 2)) throw new Error("contradictory ACK quantities");
      if ([...known].some(([id, c]) => c === cid && id !== body.order_id)) { poison(cid, String(body.order_id)); throw new Error("ambiguous ACK association"); }
      if (known.has(body.order_id) && known.get(body.order_id) !== cid) { poison(cid, String(body.order_id)); poison(known.get(body.order_id)!, String(body.order_id)); throw new Error("conflicting create ACK identity"); }
      known.set(body.order_id, cid);
      return { order_id: body.order_id, fill_count: String(body.fill_count), remaining_count: String(body.remaining_count) };
    },
    createOrder(req) { return transport.dispatchCreate(transport.prepareCreate(req)); },
    forgetIntendedOrders() { known.clear(); }, // Never clear poison on reuse/restore.
    intendedAssociation(id, cid) { return nonblank(id) && nonblank(cid) && known.get(id) === cid && !ambiguous.has(cid) && !ambiguousOrders.has(id); },
    rememberIntendedOrder(id, cid) {
      if (!nonblank(id) || !cid.startsWith("mm-perps-v2-")) throw new Error("invalid intended association");
      const prior = known.get(id);
      if ([...known].some(([order, c]) => c === cid && order !== id)) { poison(cid,id); throw new Error("ambiguous intended CID association"); }
      if (prior && prior !== cid) { poison(prior,id); poison(cid,id); throw new Error("ambiguous intended order"); }
      if (ambiguous.has(cid) || ambiguousOrders.has(id)) { poison(cid,id); throw new Error("ambiguous intended identity"); }
      known.set(id, cid);
    },
    async cancelOrder(id) {
      if (!writeIO) throw new Error("scoped writes unavailable");
      if (!nonblank(id) || id === "." || id === ".." || !known.has(id) || !transport.intendedAssociation(id, known.get(id)!)) throw new Error("unknown scoped order association");
      await orderHistory({}, rows => {
        const matches = rows.filter(r => r.order_id === id);
        if (matches.length !== 1 || matches[0]!.client_order_id !== known.get(id) ||
            rows.filter(r => r.client_order_id === known.get(id)).length !== 1) throw new Error("unverified scoped cancel association");
      });
      await write(Object.freeze({ url: scope.origin + path(orders + "/" + encodeURIComponent(id)), method: "DELETE" }));
    },
    async cancelAll() { await write(Object.freeze({ url: scope.origin + path(orders), method: "DELETE" })); },
    listOrders(q) { return orderHistory(q, rows => rows.map(mapMarginOrder)); },
    async fills(q) {
      const rows = (await history(path(fills, { ...q, limit: 1000 }), "fills")).map(object);
      if (rows.some((r) => (r.subaccount !== undefined && r.subaccount !== scope.subaccount) ||
          (r.subaccount_type !== undefined && r.subaccount_type !== "cross"))) throw new Error("conflicting scoped fill history");
      return rows.map(mapMarginFill);
    },
    async positions() {
      const rows = (await array(positions, "positions")).map(object);
      const seen = new Set<string>();
      for (const row of rows) {
        mapMarginPosition(row);
        if (!Number.isSafeInteger(row.subaccount) || Number(row.subaccount) < 0 ||
            !["cross", "isolated", "auto_rebalance", "managed_isolated"].includes(String(row.subaccount_type))) throw new Error("position scope unknown");
        const key = JSON.stringify([row.subaccount, row.subaccount_type, row.market_ticker]);
        if (seen.has(key)) throw new Error("ambiguous position scope");
        seen.add(key);
      }
      return rows.filter((r) => r.subaccount === scope.subaccount && r.subaccount_type === "cross").map((row) => {
        const mapped = mapMarginPosition(row);
        // Existing Intent.qty is a Number. Unknown rather than silently round an exact venue quantity.
        if (scopedUnits(mapped.position, 2) !== scopedUnits(String(Number(mapped.position)), 2)) throw new Error("position quantity not representable by OMS");
        return mapped;
      });
    },
    async getCrossExitTriggers(ticker) {
      return (await array(trigger(ticker), "exit_triggers")).map((x) => {
        const row = object(x);
        if (row.ticker !== ticker || !["bracket", "trailing"].includes(String(row.kind)) ||
            !["pending_on_entry", "active", "filled", "failed", "canceled", "unknown"].includes(String(row.status)) ||
            !decimal(row.count, 2) || !decimal(row.filled_count, 2)) throw new Error("ambiguous scoped trigger readback");
        for (const key of ["stop_loss_price", "take_profit_price", "trail_amount"]) {
          if (row[key] !== undefined && !decimal(row[key], 6, true)) throw new Error("malformed scoped trigger price");
        }
        return { ...mapExitTrigger(row), filled_count: String(row.filled_count) };
      });
    },
    prepareProtection(ticker, body, association) {
      // Detached primitive identity: later caller mutation cannot replace the checked association.
      const captured = Object.freeze({ orderId: association.orderId, cid: association.cid });
      if (!transport.intendedAssociation(captured.orderId,captured.cid)) throw new Error("ambiguous or unknown protection association");
      const request: Request = Object.freeze({ url: scope.origin + trigger(ticker), method: "PUT", body: triggerBody(body) });
      protectionIssued.set(request,captured); return request;
    },
    async dispatchProtection(request) {
      const association = protectionIssued.get(request);
      if (!association || !transport.intendedAssociation(association.orderId,association.cid)) throw new Error("unissued or ambiguous protection request");
      protectionIssued.delete(request);
      const reply = await write(request), id = object(reply.body).id;
      if (!nonblank(id)) throw new Error("missing scoped trigger id");
      return { id };
    },
    async setCrossExitTrigger(ticker, body) {
      // Explicit account-level transport capability; not the journal-associated OMS repair path.
      const reply = await write(Object.freeze({ url: scope.origin + trigger(ticker), method: "PUT", body: triggerBody(body) }));
      const id = object(reply.body).id;
      if (!nonblank(id)) throw new Error("missing scoped trigger id");
      return { id };
    },
    async updateCrossExitTrigger(ticker, id, body) {
      const reply = await write(Object.freeze({ url: scope.origin + trigger(ticker, id), method: "PUT", body: triggerBody(body) }));
      const result = object(reply.body).id;
      if (!nonblank(result)) throw new Error("missing scoped trigger id");
      return { id: result };
    },
    async cancelCrossExitTriggers(ticker) { await write(Object.freeze({ url: scope.origin + trigger(ticker), method: "DELETE" })); },
    readEvidence(tickers) { return readAccountRequestEvidence(scope.origin, scope, tickers, history, (p, field) => array(p, field)); },
  };
  constructed.add(transport);
  return Object.freeze(transport);
}
