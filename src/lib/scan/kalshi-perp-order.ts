import { randomUUID } from "node:crypto";
import { liveExecutionAllowed, liveFlagOn } from "@/lib/envelope/kill.server";
import { kalshiGet, kalshiPost, kalshiPut } from "./kalshi-auth";

const ORDER_PATH = "/trade-api/v2/margin/orders";

export type PerpSide = "bid" | "ask";

export type PerpOrder = {
  ticker: string;
  side: PerpSide;
  /** Limit in dollars, not cents. */
  price: number;
  count: number;
  reduceOnly?: boolean;
};

export async function marginCash(): Promise<number> {
  const { data } = await kalshiGet<{ available_balance?: string; balance?: string }>(
    "/trade-api/v2/margin/balance?compute_available_balance=true",
  );
  const n = Number(data.available_balance ?? data.balance ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Long is bid. Short is ask. Immediate or cancel. Does not rest. */
export async function placePerpOrder(order: PerpOrder) {
  if (!liveExecutionAllowed()) throw new Error(liveFlagOn() ? "not begun" : "live path off");
  if (!(order.price > 0) || !(order.count > 0)) throw new Error("perp order empty");
  let group = "";
  try {
    const created = await kalshiPost<{ order_group_id?: string; id?: string }>("/trade-api/v2/margin/order_groups/create", {
      contracts_limit_fp: order.count.toFixed(6),
      exchange_index: 0,
    });
    if (created.status === 200 || created.status === 201) group = created.data.order_group_id ?? created.data.id ?? "";
  } catch {
    group = "";
  }
  const body = {
    ticker: order.ticker,
    client_order_id: randomUUID(),
    side: order.side,
    count: order.count.toFixed(6),
    price: order.price.toFixed(4),
    time_in_force: "immediate_or_cancel" as const,
    post_only: false,
    reduce_only: Boolean(order.reduceOnly),
    self_trade_prevention_type: "taker_at_cross" as const,
    cancel_order_on_pause: true,
    ...(group ? { order_group_id: group } : {}),
  };
  const res = await kalshiPost<{ order_id?: string; order?: { order_id?: string } }>(ORDER_PATH, body);
  if (res.status !== 200 && res.status !== 201) throw new Error(`Kalshi margin ${res.status} ${res.text.slice(0, 180)}`);
  return { orderId: res.data.order_id ?? res.data.order?.order_id ?? body.client_order_id, body };
}

/** Exchange stop and target. 10% of margin is the stop. 20% of margin is the first target. */
export async function armPerpBracket(ticker: string, stop: number, takeProfit: number) {
  const path = `/trade-api/v2/margin/cross/positions/${encodeURIComponent(ticker)}/exit_trigger`;
  const res = await kalshiPut<{ ok?: boolean }>(path, {
    kind: "bracket",
    stop_loss_price: stop.toFixed(4),
    take_profit_price: takeProfit.toFixed(4),
  });
  if (res.status !== 200 && res.status !== 201) throw new Error(`Kalshi bracket ${res.status} ${res.text.slice(0, 160)}`);
  return res.status;
}
