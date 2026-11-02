import { describe, expect, it } from "bun:test";
import { parseMarginAccount, summarizeFillPnl } from "./account-state";

const payload = { subaccount_balances: [{
  subaccount: 0, subaccount_type: "cross", position_value: "0.0000",
  account_equity: "250.0000", maintenance_margin: "25.0000",
  initial_margin: "50.0000", resting_orders_margin: "10.0000",
  available_balance: "190.0000",
}], settled_funds: "250.0000" };

describe("authoritative Kalshi margin account reads", () => {
  it("extracts the actual computed venue collateral and exposure", () => {
    const r = parseMarginAccount(payload);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.account.equityUsd).toBe(250);
      expect(r.account.availableUsd).toBe(190);
      expect(r.account.restingOrderMarginUsd).toBe(10);
    }
  });
  it("refuses missing computed balance, non-cross margin, or ambiguous account", () => {
    expect(parseMarginAccount({ subaccount_balances: [{ ...payload.subaccount_balances[0], available_balance: undefined }] }).ok).toBe(false);
    expect(parseMarginAccount({ subaccount_balances: [{ ...payload.subaccount_balances[0], subaccount_type: "isolated" }] }).ok).toBe(false);
    expect(parseMarginAccount({ subaccount_balances: [payload.subaccount_balances[0], payload.subaccount_balances[0]] }).ok).toBe(false);
    expect(parseMarginAccount({ subaccount_balances: [{ ...payload.subaccount_balances[0], available_balance: "1000" }] }).ok).toBe(false);
  });
  it("summarizes authenticated fill P&L without pretending it is total equity drawdown", () => {
    const t = "2026-11-02T09:00:00Z";
    const r = summarizeFillPnl([
      { fill_id: "a", created_time: t, realized_pnl: "-3.25", fees: "0.10" },
      { fill_id: "a", created_time: t, realized_pnl: "-3.25", fees: "0.10" },
      { fill_id: "b", created_time: t, realized_pnl: "1.00", fees: "0.20" },
    ], Date.parse("2026-11-02T00:00:00Z"), Date.parse("2026-11-03T00:00:00Z"));
    expect(r.ok).toBe(true);
    if(r.ok) {
      expect(r.count).toBe(2);
      expect(r.afterFillFeesUsd).toBeCloseTo(-2.55, 6);
      expect(r.authoritativeDayLoss).toBe(false);
    }
  });
});
