/** Signed Kalshi margin orders. One lot that costs more than the desk cap is refused before this runs. */
import { postMarginOrder } from "@/lib/desk/oms";
import type { CreateReq, PerpsTransport } from "./oms";

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
  async cancelOrder() { throw new Error("use the desk kill path"); },
  async cancelAll() { throw new Error("use the desk kill path"); },
  async listOrders() { return []; },
  async fills() { return []; },
  async positions() { return []; },
  async setCrossExitTrigger() { throw new Error("bracket not attached on this send"); },
  async updateCrossExitTrigger() { throw new Error("bracket not attached on this send"); },
};
