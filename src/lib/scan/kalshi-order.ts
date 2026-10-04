import { liveExecutionAllowed } from "@/lib/envelope/kill.server";
import { kalshiDelete, kalshiGet, kalshiPost, liveFlagOn, probeKalshi } from "./kalshi-auth";
import { DEAD, DONE_FILL, eventCancelPath, mayCancel, orderStatusOf, type ExchangeOrder } from "./kalshi-order-status";
import type { UpDownLeg } from "./updown";
import { randomUUID } from "node:crypto";

const PATH = "/trade-api/v2/portfolio/events/orders";

export type EventOrder = {
  ticker: string;
  leg: UpDownLeg;
  yes: number;
  sizeUsd: number;
  /** Pay the ask. Used only when the index has already broken the line. */
  cross?: boolean;
};

export type EventFill = {
  orderId: string;
  fillCount: number;
  avgPrice: number;
  yesPaid: number;
  count: number;
  side: "bid" | "ask";
  remaining: number;
  status: string;
};

function money(n: number) {
  return n.toFixed(4);
}

/** YES-only book: bid = buy YES (up). ask = sell YES = buy NO (down) at 1 − price. */
export function yesBook(leg: UpDownLeg, yesPaid: number): { side: "bid" | "ask"; price: number } {
  if (leg === "up") return { side: "bid", price: yesPaid };
  return { side: "ask", price: Math.max(0.01, 1 - yesPaid) };
}

export async function pollOrder(orderId: string, tries = 12, waitMs = 400): Promise<ReturnType<typeof orderStatusOf>> {
  let last = { raw: {} as ExchangeOrder, status: "unknown", fill: 0, remaining: 0, avg: 0 };
  for (let i = 0; i < tries; i++) {
    const { data } = await kalshiGet<ExchangeOrder | { order?: ExchangeOrder }>(
      `/trade-api/v2/portfolio/orders/${orderId}?exchange_index=2`,
    );
    last = orderStatusOf(data);
    if (DONE_FILL.has(last.status) || last.fill > 0 && last.remaining === 0) return last;
    if (DEAD.has(last.status)) return last;
    if (last.fill > 0) return last;
    if (i < tries - 1) await new Promise((r) => setTimeout(r, waitMs));
  }
  return last;
}

export async function placeEventOrder(order: EventOrder): Promise<EventFill> {
  if (!liveExecutionAllowed()) throw new Error(liveFlagOn() ? "not begun" : "live path off");
  if (order.yes < 0.2 || order.yes > 0.45) throw new Error("yes out of band");
  const pay = Number(order.yes.toFixed(4));
  const { side, price } = yesBook(order.leg, pay);
  const count = Math.max(1, Math.floor(order.sizeUsd / Math.max(pay, 0.01)));
  const clientOrderId = randomUUID();
  async function post(id: string, exchangeIndex: number) {
    const body = {
      ticker: order.ticker,
      client_order_id: id,
      side,
      count: count.toFixed(2),
      price: money(price),
      time_in_force: "immediate_or_cancel" as const,
      self_trade_prevention_type: "taker_at_cross" as const,
      post_only: false,
      exchange_index: exchangeIndex,
    };
    try {
      const res = await kalshiPost<{
        order_id?: string;
        order?: { order_id?: string };
        fill_count?: string;
        fill_count_fp?: string;
        remaining_count?: string;
        remaining_count_fp?: string;
        average_fill_price?: string;
        status?: string;
        error?: { message?: string };
        message?: string;
      }>(PATH, body);
      return { body, res };
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      return {
        body,
        res: {
          host: "",
          status: 404,
          data: {} as { order_id?: string; order?: { order_id?: string } },
          text,
        },
      };
    }
  }
  let { body, res } = await post(clientOrderId, 2);
  const missing = res.status === 404 || /not_found/.test(res.text ?? "");
  if (missing) {
    ({ body, res } = await post(randomUUID(), -1));
  }
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`Kalshi ${res.status} ${res.text.slice(0, 220)}`);
  }
  const orderId = res.data.order_id ?? res.data.order?.order_id ?? body.client_order_id;
  const postedFill = Number(res.data.fill_count_fp ?? res.data.fill_count ?? 0);
  const postedLeft = Number(res.data.remaining_count_fp ?? res.data.remaining_count ?? count);
  const postedAvg = Number(res.data.average_fill_price ?? 0);
  if (postedFill === 0 && postedLeft > 0) {
    throw new Error(`Kalshi no fill · ${orderId}`);
  }
  if (postedFill > 0 && postedLeft === 0) {
    const avg = postedAvg || price;
    return {
      orderId,
      fillCount: postedFill,
      avgPrice: avg,
      yesPaid: order.leg === "up" ? avg : 1 - avg,
      count,
      side,
      remaining: 0,
      status: "executed",
    };
  }
  const polled = await pollOrder(orderId);
  if (polled.fill > 0 && polled.remaining === 0) {
    const avg = polled.avg || postedAvg || price;
    return {
      orderId,
      fillCount: polled.fill,
      avgPrice: avg,
      yesPaid: order.leg === "up" ? avg : 1 - avg,
      count,
      side,
      remaining: 0,
      status: polled.status,
    };
  }
  if (mayCancel(polled.status, polled.fill)) {
    await kalshiDelete(eventCancelPath(orderId, order.ticker)).catch(() => null);
  }
  if (polled.fill > 0) {
    const avg = polled.avg || postedAvg || price;
    return {
      orderId,
      fillCount: polled.fill,
      avgPrice: avg,
      yesPaid: order.leg === "up" ? avg : 1 - avg,
      count,
      side,
      remaining: polled.remaining,
      status: polled.status,
    };
  }
  throw new Error(`Kalshi ${polled.status || "unknown"} no fill · ${orderId}`);
}

/** A resting bid stays up until it fills or the window says pull it. */
export async function watchRest(orderId: string, ticker: string, cancel: boolean) {
  const polled = await pollOrder(orderId, 1, 0);
  if (polled.fill > 0) {
    return { kind: "fill" as const, fill: polled.fill, avg: polled.avg, status: polled.status };
  }
  if (cancel && mayCancel(polled.status, polled.fill)) {
    await kalshiDelete(eventCancelPath(orderId, ticker)).catch(() => null);
    return { kind: "cancelled" as const };
  }
  if (DEAD.has(polled.status)) return { kind: "cancelled" as const };
  return { kind: "open" as const };
}

export async function liveReadyNow() {
  if (!liveFlagOn()) return { ok: false, why: "live path off" };
  if (!liveExecutionAllowed()) return { ok: false, why: "not begun" };
  const p = await probeKalshi();
  if (!p.auth) return { ok: false, why: p.error ?? "auth" };
  const shard2 = p.shards?.find((s) => s.index === 2)?.usd ?? 0;
  if (shard2 < 5) return { ok: false, why: `crypto shard 2 has $${shard2}` };
  return { ok: true, why: `live · shard2 $${shard2}` };
}
