export type ExchangeOrder = {
  order_id?: string;
  status?: string;
  fill_count?: string;
  fill_count_fp?: string;
  remaining_count?: string;
  remaining_count_fp?: string;
  average_fill_price?: string;
  yes_price_dollars?: string;
};

const OPEN = new Set(["resting", "open", "pending", "active", "untriggered"]);
const DONE_FILL = new Set(["executed", "filled"]);
const DEAD = new Set(["canceled", "cancelled", "rejected", "expired"]);

export function orderStatusOf(raw: ExchangeOrder | { order?: ExchangeOrder }) {
  const o = "order" in raw && raw.order ? raw.order : (raw as ExchangeOrder);
  const status = String(o.status ?? "").toLowerCase();
  const fill = Number(o.fill_count_fp ?? o.fill_count ?? 0);
  const remaining = Number(o.remaining_count_fp ?? o.remaining_count ?? 0);
  const avg = Number(o.average_fill_price ?? 0);
  return { raw: o, status, fill, remaining, avg };
}

export function mayCancel(status: string, fill: number) {
  if (DONE_FILL.has(status)) return false;
  if (DEAD.has(status)) return false;
  if (fill > 0 && remainingClosed(status, fill)) return false;
  return OPEN.has(status) && fill === 0;
}

function remainingClosed(status: string, fill: number) {
  return fill > 0 && !OPEN.has(status);
}

export function reconcileOrder(
  ledgerOrderId: string | null,
  exchangeOrderId: string | null,
  status: string,
  fill: number,
) {
  if (!ledgerOrderId || !exchangeOrderId || ledgerOrderId !== exchangeOrderId) {
    return { ok: false, why: "order_id mismatch" };
  }
  const s = status.toLowerCase();
  if (!s || s === "unknown") return { ok: false, why: "unknown status" };
  if (DONE_FILL.has(s) && fill <= 0) return { ok: false, why: "filled status with zero fill" };
  if (s === "partial" || (fill > 0 && OPEN.has(s))) return { ok: true, why: "partial" };
  if (DONE_FILL.has(s)) return { ok: true, why: "filled" };
  if (DEAD.has(s)) return { ok: true, why: s };
  if (OPEN.has(s) && fill === 0) return { ok: true, why: "open" };
  return { ok: false, why: `unhandled ${s}` };
}

export function eventCancelPath(orderId: string, ticker: string) {
  const q = new URLSearchParams({ exchange_index: "2", market_ticker: ticker });
  return `/trade-api/v2/portfolio/events/orders/${encodeURIComponent(orderId)}?${q.toString()}`;
}

export { OPEN, DONE_FILL, DEAD };
