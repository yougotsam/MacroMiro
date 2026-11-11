import { createCrossAccountTransport } from "./cross-account";
import { KALSHI_HOST, kalshiSignedHeaders } from "@/lib/scan/kalshi-auth";
import { postMarginOrder, putMargin } from "@/lib/desk/oms";
import type { CreateReq, PerpsTransport } from "./oms";
import type { SnapshotReads } from "./scoped-snapshot";
import { marginCancelPath, exitTriggerPath, qs, triggerId, mapMarginOrder, mapMarginFill, mapMarginPosition, mapExitTrigger, readMarginHistory, readMarginArray } from "./margin-wire";
export { marginCancelPath, exitTriggerPath, mapMarginOrder, mapMarginFill, mapMarginPosition, mapExitTrigger, readMarginHistory, readMarginArray } from "./margin-wire";
const ORDERS = "/trade-api/v2/margin/orders";
const FILLS = "/trade-api/v2/margin/fills";
const POSITIONS = "/trade-api/v2/margin/positions";
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
    return (await readMarginHistory(path, "orders", (p) => margin("GET", p))).map(mapMarginOrder);
  },
  async fills(q) {
    const path = `${FILLS}${qs({ min_ts: q.min_ts, limit: 1000 })}`;
    return (await readMarginHistory(path, "fills", (p) => margin("GET", p))).map(mapMarginFill);
  },
  async positions() {
    return (await readMarginArray(POSITIONS, "positions", (p) => margin("GET", p))).map(mapMarginPosition);
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
    return (await readMarginArray(exitTriggerPath(ticker), "exit_triggers", (p) => margin("GET", p))).map(mapExitTrigger);
  },
  async cancelCrossExitTriggers(ticker) {
    const res = await margin("DELETE", exitTriggerPath(ticker));
    if (res.status !== 204 && res.status !== 200) throw new Error(`margin trigger cancel http ${res.status} ${res.text}`);
  },
};

/** Raw read-only attribution source. Not an OMS transport or authorization path. */
export const marginSnapshotReads: SnapshotReads = {
  sourceOrigin: KALSHI_HOST,
  async positions() {
    const rows = await readMarginArray(POSITIONS, "positions", (p) => margin("GET", p));
    rows.forEach(mapMarginPosition); // Validate required values, retain raw metadata.
    return rows;
  },
  orders: () => readMarginHistory(`${ORDERS}?limit=1000`, "orders", (p) => margin("GET", p)),
  fills: () => readMarginHistory(`${FILLS}?limit=1000`, "fills", (p) => margin("GET", p)),
};

/** Separate consumed GET-only evidence; never change the legacy OMS transport. */
export async function marginAccountRequestEvidence(
  selection: import("./scoped-snapshot").MarginAccount, tickers: readonly string[],
) {
  if (selection.subaccount_type === "cross") {
    return createCrossAccountTransport({ origin: KALSHI_HOST, subaccount: selection.subaccount, subaccount_type: "cross" }, {
      read: async (request) => {
        const url = new URL(request.url);
        if (url.origin !== KALSHI_HOST || request.method !== "GET") throw new Error("read-only origin/method mismatch");
        return margin("GET", url.pathname + url.search);
      },
    }).readEvidence(tickers);
  }
  const { readAccountRequestEvidence } = await import("./request-evidence");
  return readAccountRequestEvidence(KALSHI_HOST, selection, tickers,
    (path, field) => readMarginHistory(path, field, (p) => margin("GET", p)),
    (path, field) => readMarginArray(path, field, (p) => margin("GET", p)));
}
