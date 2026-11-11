import type { ExitTrigger, VenueFill, VenueOrder, VenuePosition } from "./oms";
const ORDERS = "/trade-api/v2/margin/orders";
export function marginCancelPath(orderId: string) {
  return `${ORDERS}/${encodeURIComponent(orderId)}`;
}

export function exitTriggerPath(ticker: string, triggerId?: string) {
  const base = `/trade-api/v2/margin/cross/positions/${encodeURIComponent(ticker)}/exit_trigger`;
  return triggerId ? `${base}/${encodeURIComponent(triggerId)}` : base;
}

export function qs(q: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v != null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

function row(x: unknown): Record<string, unknown> {
  return x && typeof x === "object" ? x as Record<string, unknown> : {};
}

export function mapMarginOrder(x: unknown): VenueOrder {
  const o = row(x);
  const side = o.side === "ask" ? "ask" : o.side === "bid" ? "bid" : null;
  if (typeof o.order_id !== "string" || !side) throw new Error("margin order missing id or side");
  return {
    order_id: o.order_id,
    client_order_id: String(o.client_order_id ?? ""),
    ticker: String(o.ticker ?? ""),
    side,
    price: String(o.price ?? ""),
    fill_count: String(o.fill_count ?? "0"),
    remaining_count: String(o.remaining_count ?? "0"),
    ...(o.last_update_reason == null ? {} : { last_update_reason: String(o.last_update_reason) }),
  };
}

export function mapMarginFill(x: unknown): VenueFill {
  const o = row(x);
  const side = o.side === "ask" ? "ask" : o.side === "bid" ? "bid" : null;
  if (typeof o.fill_id !== "string" || typeof o.order_id !== "string" || !side) throw new Error("margin fill missing id or side");
  return {
    fill_id: o.fill_id,
    order_id: o.order_id,
    is_taker: o.is_taker === true,
    side,
    count: String(o.count ?? "0"),
    price: String(o.price ?? ""),
    fees: String(o.fees ?? "0"),
    realized_pnl: String(o.realized_pnl ?? "0"),
    ticker: String(o.ticker ?? ""),
    created_time: String(o.created_time ?? ""),
  };
}

export function mapMarginPosition(x: unknown): VenuePosition {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Error("malformed margin position");
  const o = x as Record<string, unknown>;
  if (typeof o.market_ticker !== "string" || o.market_ticker.trim() === "") throw new Error("margin position missing ticker");
  const fixed = (key: string, decimals: number): string => {
    const value = o[key];
    const pattern = new RegExp(`^-?[0-9]+(?:[.][0-9]{1,${decimals}})?$`);
    if (typeof value !== "string" || !pattern.test(value) || !Number.isFinite(Number(value))) {
      throw new Error(`margin position invalid ${key}`);
    }
    // Guard the scaled representation; this does not make later Number math exact.
    const unsigned = value.startsWith("-") ? value.slice(1) : value;
    const [whole, fraction = ""] = unsigned.split(".");
    const scaled = BigInt(whole + fraction.padEnd(decimals, "0"));
    if (scaled > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`margin position unsafe ${key}`);
    return value;
  };
  return {
    market_ticker: o.market_ticker,
    position: fixed("position", 2),
    entry_price: fixed("entry_price", 6),
    unrealized_pnl: fixed("unrealized_pnl", 6),
    fees: fixed("fees", 6),
  };
}

export function mapExitTrigger(x: unknown): ExitTrigger {
  const o = row(x);
  const prices = row(o.prices);
  const id = typeof o.id === "string" ? o.id : "";
  if (!id) throw new Error("margin trigger missing id");
  const pick = (k: string) => {
    const v = o[k] ?? prices[k];
    return v == null || v === "" ? null : String(v);
  };
  const rawCount = o.count;
  const count = rawCount == null ? null : typeof rawCount === "object" ? (String(row(rawCount).count ?? "") || null) : String(rawCount);
  return { id, kind: String(o.kind ?? "bracket"), status: o.status == null ? null : String(o.status), stop: pick("stop_loss_price"), take: pick("take_profit_price"), count, trail: pick("trail_amount") };
}

export function triggerId(body: Record<string, unknown>) {
  if (typeof body.id === "string" && body.id) return body.id;
  const nested = row(body.exit_trigger);
  if (typeof nested.id === "string" && nested.id) return nested.id;
  throw new Error("margin trigger reply missing id");
}

function withCursor(path: string, cursor: string) {
  if (!cursor) return path;
  return `${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/** Complete only within requested filters; not an atomic account snapshot.
 * Strict margin-schema policy: cursor must be a string; empty string terminates.
 * Null/absent cursors fail closed pending verified margin-demo compatibility.
 */
export async function readMarginHistory(path: string, field: "orders" | "fills", readPage: (path: string) => Promise<{ status: number; body: unknown }>): Promise<unknown[]> {
  const idField = field === "orders" ? "order_id" : "fill_id";
  const records = new Map<string, { signature: string; value: unknown }>();
  const seenCursors = new Set<string>();
  let cursor = "";
  for (let page = 0; page < 5; page++) {
    const reply = await readPage(withCursor(path, cursor));
    if (reply.status !== 200) throw new Error(`margin ${field} http ${reply.status}`);
    const body = reply.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(`malformed margin ${field} response`);
    const payload = body as Record<string, unknown>;
    const items = payload[field];
    const next = payload.cursor;
    if (!Array.isArray(items) || typeof next !== "string") throw new Error(`malformed margin ${field} array or cursor`);
    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`malformed margin ${field} record`);
      const id = (item as Record<string, unknown>)[idField];
      if (typeof id !== "string" || id.trim() === "") throw new Error(`margin ${field} record missing identity`);
      const signature = canonicalJson(item);
      const prior = records.get(id);
      // Mutable orders can change between pages: reconcile again, never pick one.
      if (prior && prior.signature !== signature) throw new Error(`conflicting duplicate margin ${field} record`);
      if (!prior) records.set(id, { signature, value: item });
    }
    if (next === "") return [...records.values()].map((record) => record.value);
    if (seenCursors.has(next)) throw new Error(`margin ${field} cursor cycle`);
    seenCursors.add(next);
    cursor = next;
  }
  throw new Error(`incomplete margin ${field} history: page limit`);
}

export async function readMarginArray(path: string, field: "positions" | "exit_triggers", readPage: (path: string) => Promise<{ status: number; body: unknown }>): Promise<unknown[]> {
  const res = await readPage(path);
  if (res.status !== 200) throw new Error(`margin ${field} http ${res.status}`);
  if (!res.body || typeof res.body !== "object" || Array.isArray(res.body)) throw new Error(`malformed margin ${field} response`);
  const items = (res.body as Record<string, unknown>)[field];
  if (!Array.isArray(items)) throw new Error(`malformed margin ${field} array`);
  return items;
}

