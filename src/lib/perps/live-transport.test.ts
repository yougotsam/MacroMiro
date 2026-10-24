import { describe, expect, it } from "bun:test";
import { mapMarginFill, mapMarginOrder, mapMarginPosition, mapExitTrigger, marginCancelPath, exitTriggerPath } from "./live-transport";

describe("margin transport maps", () => {
  it("cancel path is the margin order, not the event book", () => {
    expect(marginCancelPath("ord/1")).toBe("/trade-api/v2/margin/orders/ord%2F1");
  });
  it("maps an order, a fill, and a position", () => {
    expect(mapMarginOrder({ order_id: "a", client_order_id: "c", ticker: "KXBTCPERP", side: "bid", price: "8.1", fill_count: "0", remaining_count: "1" }).side).toBe("bid");
    expect(mapMarginFill({ fill_id: "f", order_id: "a", is_taker: false, side: "ask", count: "1", price: "8", fees: "0.01", realized_pnl: "0", ticker: "KXBTCPERP", created_time: "t" }).is_taker).toBe(false);
    expect(mapMarginPosition({ market_ticker: "KXBTCPERP", position: "1", entry_price: "8", unrealized_pnl: "0", fees: "0" }).position).toBe("1");
  });
  it("stop path is the cross exit trigger, and a listed trigger keeps its stop", () => {
    expect(exitTriggerPath("KXBTCPERP")).toBe("/trade-api/v2/margin/cross/positions/KXBTCPERP/exit_trigger");
    expect(exitTriggerPath("KXBTCPERP", "trg-1")).toBe("/trade-api/v2/margin/cross/positions/KXBTCPERP/exit_trigger/trg-1");
    expect(mapExitTrigger({ id: "trg-1", kind: "bracket", prices: { stop_loss_price: "8.00", take_profit_price: "8.40" } })).toMatchObject({ id: "trg-1", stop: "8.00", take: "8.40" });
  });
  it("refuses a row that has no side", () => {
    expect(() => mapMarginOrder({ order_id: "a" })).toThrow(/side/);
  });
});
