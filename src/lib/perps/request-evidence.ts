/** Request-filter evidence, never reported row identity or credential authorization.
 * Sources: docs.kalshi.com/margin-rest/orders/get-orders.md,
 * margin-rest/portfolio/get-fills.md, exit-triggers/get-cross-exit-triggers.md.
 */
import { copySnapshotJson, type MarginAccount } from "./scoped-snapshot";
export type RequestList = Readonly<{
  sourceOrigin: string;
  request: Readonly<{ method: "GET"; path: string; subaccount: number }>;
  rows: readonly unknown[];
}>;
export type AccountRequestEvidence = Readonly<{
  startedAt: string; finishedAt: string;
  orders: RequestList; fills: RequestList; crossTriggers: readonly RequestList[];
}>;
export async function readAccountRequestEvidence(
  sourceOrigin: string,
  selection: MarginAccount,
  tickers: readonly string[],
  readHistory: (path: string, field: "orders" | "fills") => Promise<unknown[]>,
  readArray: (path: string, field: "exit_triggers") => Promise<unknown[]>,
): Promise<AccountRequestEvidence> {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) throw new Error("invalid request evidence scope");
  const numberField = Object.getOwnPropertyDescriptor(selection, "subaccount");
  const typeField = Object.getOwnPropertyDescriptor(selection, "subaccount_type");
  if (!numberField || !("value" in numberField) || !typeField || !("value" in typeField) ||
      typeof sourceOrigin !== "string") throw new Error("invalid request evidence scope");
  const subaccount: unknown = numberField.value;
  const type: unknown = typeField.value;
  const origin = new URL(sourceOrigin);
  if (!["https:", "http:"].includes(origin.protocol) || origin.origin !== sourceOrigin ||
      typeof subaccount !== "number" || !Number.isSafeInteger(subaccount) || subaccount < 0 ||
      typeof type !== "string" || !["cross", "isolated", "auto_rebalance", "managed_isolated"].includes(type)) {
    throw new Error("invalid request evidence scope");
  }
  // Only cross is reviewed here. Other inventory modes remain visible, not routed.
  const uniqueTickers = [...new Set(tickers)];
  if (uniqueTickers.some((t) => typeof t !== "string" || !t.trim() || t === "." || t === "..")) throw new Error("invalid trigger ticker");
  const crossTickers = type === "cross" ? uniqueTickers : [];
  const list = (path: string, pending: Promise<unknown[]>): Promise<RequestList> => pending.then((rows) => {
    if (!Array.isArray(rows)) throw new Error("malformed request evidence list");
    return copySnapshotJson({ sourceOrigin, request: { method: "GET", path, subaccount }, rows }) as RequestList;
  });
  const ordersPath = `/trade-api/v2/margin/orders?limit=1000&subaccount=${subaccount}`;
  const fillsPath = `/trade-api/v2/margin/fills?limit=1000&subaccount=${subaccount}`;
  const startedAt = new Date().toISOString();
  const [orders, fills, crossTriggers] = await Promise.all([
    list(ordersPath, readHistory(ordersPath, "orders")),
    list(fillsPath, readHistory(fillsPath, "fills")),
    Promise.all(crossTickers.map((ticker) => {
      const path = `/trade-api/v2/margin/cross/positions/${encodeURIComponent(ticker)}/exit_trigger?subaccount=${subaccount}`;
      return list(path, readArray(path, "exit_triggers"));
    })),
  ]);
  return Object.freeze({ startedAt, finishedAt: new Date().toISOString(), orders, fills, crossTriggers: Object.freeze(crossTriggers) });
}
