/** Signed Kalshi margin orders. One lot that costs more than the desk cap is refused before this runs.
 * Cancel, the open-order list, fills, and positions hit the same host as the post. An empty list is what Kalshi returned. */
import { KALSHI_HOST, kalshiSignedHeaders } from "@/lib/scan/kalshi-auth";
import { postMarginOrder, putMargin } from "@/lib/desk/oms";
import type { CreateReq, ExitTrigger, PerpsTransport, VenueFill, VenueOrder, VenuePosition } from "./oms";

const ORDERS = "/trade-api/v2/margin/orders";
const FILLS = "/trade-api/v2/margin/fills";
const POSITIONS = "/trade-api/v2/margin/positions";

export function marginCancelPath(orderId: string) {
  return `${ORDERS}/${encodeURIComponent(orderId)}`;
}

export function exitTriggerPath(ticker: string, triggerId?: string) {
  const base = `/trade-api/v2/margin/cross/positions/${encodeURIComponent(ticker)}/exit_trigger`;
  return triggerId ? `${base}/${encodeURIComponent(triggerId)}` : base;
}

function qs(q: Record<string, string | number | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v != null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

type Reply = { status: number; body: Record<string, unknown>; text: string };

async function margin(method: "GET" | "DELETE", path: string): Promise<Reply> {
  const res = await fetch(`${KALSHI_HOST}${path}`, {
    method,
    headers: kalshiSignedHeaders(method, path),
    signal: AbortSignal.timeout(8_000),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  if (text) {
    try { body = JSON.parse(text) as Record<string, unknown>; } catch { /* not json */ }
  }
  return { status: res.status, body, text: text.slice(0, 400) };
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
  const o = row(x);
  if (typeof o.market_ticker !== "string") throw new Error("margin position missing ticker");
  return {
    market_ticker: o.market_ticker,
    position: String(o.position ?? "0"),
    entry_price: String(o.entry_price ?? "0"),
    unrealized_pnl: String(o.unrealized_pnl ?? "0"),
    fees: String(o.fees ?? "0"),
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
  return { id, kind: String(o.kind ?? "bracket"), stop: pick("stop_loss_price"), take: pick("take_profit_price"), count, trail: pick("trail_amount") };
}

function triggerId(body: Record<string, unknown>) {
  if (typeof body.id === "string" && body.id) return body.id;
  const nested = row(body.exit_trigger);
  if (typeof nested.id === "string" && nested.id) return nested.id;
  throw new Error("margin trigger reply missing id");
}

function withCursor(path: string, cursor: string) {
  if (!cursor) return path;
  return `${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}`;
}

export const liveMarginTransport: PerpsTransport = {
  async createOrder(r: CreateReq) {
    const res = await postMarginOrder({ ...r });
    if (res.status !== 200 && res.status !== 201) throw new Error(`margin http ${res.status} ${res.text.slice(0, 160)}`);
    const body = (res.body.order && typeof res.body.order === "object" ? res.body.order : res.body) as Record<string, unknown>;
    return {
      order_id: String(body.order_id ?? ""),
      fill_count: String(body.fill_count ?? "0"),
      remaining_count: String(body.remaining_count ?? "0"),
    };
  },
  async cancelOrder(orderId: string) {
    if (!orderId) throw new Error("margin cancel needs an order id");
    const res = await margin("DELETE", marginCancelPath(orderId));
    if (res.status === 200 || res.status === 204 || res.status === 404) return;
    throw new Error(`margin cancel http ${res.status} ${res.text}`);
  },
  async cancelAll() {
    const res = await margin("DELETE", ORDERS);
    if (res.status !== 204 && res.status !== 200) throw new Error(`margin cancel-all http ${res.status} ${res.text}`);
  },
  async listOrders(q) {
    const path = `${ORDERS}${qs({ ticker: q.ticker, min_ts: q.min_ts, status: q.status, limit: 1000 })}`;
    const rows: unknown[] = [];
    let cursor = "";
    for (let i = 0; i < 5; i++) {
      const res = await margin("GET", withCursor(path, cursor));
      if (res.status !== 200) throw new Error(`margin orders http ${res.status} ${res.text}`);
      if (Array.isArray(res.body.orders)) rows.push(...res.body.orders);
      const next = typeof res.body.cursor === "string" ? res.body.cursor : "";
      if (!next || next === cursor) break;
      cursor = next;
    }
    return rows.map(mapMarginOrder);
  },
  async fills(q) {
    const path = `${FILLS}${qs({ min_ts: q.min_ts, limit: 1000 })}`;
    const rows: unknown[] = [];
    let cursor = "";
    for (let i = 0; i < 5; i++) {
      const res = await margin("GET", withCursor(path, cursor));
      if (res.status !== 200) throw new Error(`margin fills http ${res.status} ${res.text}`);
      if (Array.isArray(res.body.fills)) rows.push(...res.body.fills);
      const next = typeof res.body.cursor === "string" ? res.body.cursor : "";
      if (!next || next === cursor) break;
      cursor = next;
    }
    return rows.map(mapMarginFill);
  },
  async positions() {
    const res = await margin("GET", POSITIONS);
    if (res.status !== 200) throw new Error(`margin positions http ${res.status} ${res.text}`);
    const rows = Array.isArray(res.body.positions) ? res.body.positions : [];
    return rows.map(mapMarginPosition);
  },
  async setCrossExitTrigger(ticker, body) {
    const res = await putMargin(exitTriggerPath(ticker), body);
    if (res.status !== 200) throw new Error(`margin trigger http ${res.status} ${res.text}`);
    return { id: triggerId(res.body) };
  },
  async updateCrossExitTrigger(ticker, id, body) {
    const res = await putMargin(exitTriggerPath(ticker, id), body);
    if (res.status !== 200) throw new Error(`margin trigger update http ${res.status} ${res.text}`);
    return { id: triggerId(res.body) };
  },
  async getCrossExitTriggers(ticker) {
    const res = await margin("GET", exitTriggerPath(ticker));
    if (res.status !== 200) throw new Error(`margin triggers http ${res.status} ${res.text}`);
    const rows = Array.isArray(res.body.exit_triggers) ? res.body.exit_triggers : [];
    return rows.map(mapExitTrigger);
  },
  async cancelCrossExitTriggers(ticker) {
    const res = await margin("DELETE", exitTriggerPath(ticker));
    if (res.status !== 204 && res.status !== 200) throw new Error(`margin trigger cancel http ${res.status} ${res.text}`);
  },
};
