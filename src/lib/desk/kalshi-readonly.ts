/**
 * Authenticated, READ-ONLY Kalshi client for reconciliation (orders, fills, positions, settlements, balance) and
 * public market status. Every call is a signed GET through `kalshiGet`; a path allow-list refuses anything else.
 * This module never imports the order transport, the cancel call, or the OMS (enforced by recovery.test.ts).
 * Nothing here logs headers, key ids or signatures.
 */
import { kalshiGet } from "@/lib/scan/kalshi-auth";
import type { KOrder } from "./kalshi-read";

const ALLOWED = [
  /^\/trade-api\/v2\/portfolio\/(?:orders|fills|positions|settlements|balance)(?:\?[A-Za-z0-9_=&%.-]*)?$/,
  /^\/trade-api\/v2\/markets\/[A-Z0-9.-]+$/,
];

export function readOnlyPathAllowed(path: string) {
  return ALLOWED.some((r) => r.test(path));
}

export type Getter = <T>(path: string) => Promise<T>;

/** The one network entry point: allow-listed signed GET. */
export const readOnlyGet: Getter = async <T>(path: string): Promise<T> => {
  if (!readOnlyPathAllowed(path)) throw new Error(`read-only client refused path ${path.split("?")[0]}`);
  return (await kalshiGet<T>(path)).data;
};

async function pages<T>(get: Getter, base: string, field: string, max = 5): Promise<T[]> {
  const out: T[] = [];
  let cursor = "";
  for (let i = 0; i < max; i += 1) {
    const p = `${base}${base.includes("?") ? "&" : "?"}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const data = await get<Record<string, unknown>>(p);
    out.push(...(((data[field] as T[]) ?? []) as T[]));
    cursor = String(data.cursor ?? "");
    if (!cursor) return out;
  }
  // more pages than we read: the evidence is incomplete, never "absent"
  throw new Error(`${field}: more than ${max} pages`);
}

export type KFill = { fill_id?: string; order_id?: string; ticker?: string; outcome_side?: string; side?: string; book_side?: string; action?: string; count_fp?: string; created_time?: string };
export type KSettlement = { ticker: string; yes_count_fp?: string; no_count_fp?: string; market_result?: string; settled_time?: string };
export type KPosition = { ticker: string; position_fp?: string };
export type KMarketStatus = { status: string; result: string; closeMs: number | null };

export type ReadOnlyKalshi = {
  ordersOnTicker(ticker: string): Promise<KOrder[]>;
  fillsOnTicker(ticker: string): Promise<KFill[]>;
  positionOnTicker(ticker: string): Promise<KPosition | null>;
  settlementsOnTicker(ticker: string): Promise<KSettlement[]>;
  market(ticker: string): Promise<KMarketStatus | null>;
};

const enc = encodeURIComponent;
export function readOnlyKalshi(get: Getter = readOnlyGet): ReadOnlyKalshi {
  return {
    ordersOnTicker: (t) => pages<KOrder>(get, `/trade-api/v2/portfolio/orders?ticker=${enc(t)}`, "orders"),
    fillsOnTicker: (t) => pages<KFill>(get, `/trade-api/v2/portfolio/fills?ticker=${enc(t)}`, "fills"),
    positionOnTicker: async (t) => {
      const rows = await pages<KPosition>(get, `/trade-api/v2/portfolio/positions?ticker=${enc(t)}`, "market_positions");
      return rows.find((r) => r.ticker === t) ?? null;
    },
    settlementsOnTicker: async (t) => (await pages<KSettlement>(get, `/trade-api/v2/portfolio/settlements?ticker=${enc(t)}`, "settlements")).filter((s) => s.ticker === t),
    market: async (t) => {
      const d = await get<{ market?: { status?: string; result?: string; close_time?: string } }>(`/trade-api/v2/markets/${t}`);
      if (!d.market) return null;
      const c = Date.parse(String(d.market.close_time ?? ""));
      return { status: String(d.market.status ?? ""), result: String(d.market.result ?? ""), closeMs: Number.isFinite(c) ? c : null };
    },
  };
}
