/** The live risk policy at the submit choke point: pile fractions, not fixed dollars (Sameer's own dollar numbers stay blank). */
import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_ORDERS_PER_TICKER_WINDOW, PRICE_MAX, PRICE_MIN } from "./config";
import { KILL_FRAC, TRADE_FRAC } from "./guard";
import { RiskEngine, type AccountSnapshot, type OrderIntent } from "./risk";
import { roomBudget } from "./sizing";
import { etDay } from "./time";

const ON = { live: () => true, begin: () => true, arm: () => true };
const OK_WD = () => ({ ok: true, why: "ok" });
const NOW = Date.now();
const T = "KXBTC15M-26OCT081200-00";
const eng = () => new RiskEngine(mkdtempSync(join(tmpdir(), "pile-")), ON, undefined, OK_WD);
const snap = (o: Partial<AccountSnapshot> = {}): AccountSnapshot => ({
  fetchedAt: NOW, etDay: etDay(NOW), realizedToday: 0, openWorst: 0, restWorst: 0, pendingWorst: 0, shard2Cash: 100,
  settledToday: [], ordersPerTicker: {}, correlated: {}, tickerWorst: {}, exchangeTradingActive: true, exchangeCheckedAt: NOW, ...o,
});
const intent = (o: Partial<OrderIntent> = {}): OrderIntent => ({ product: "event", ticker: T, side: "yes", mode: "maker", price: 0.5, count: 2, fee: 0, tickId: 1, ...o });

describe("pile risk policy", () => {
  it("one trade is capped at 8% of the pile; the day stops at 25%", () => {
    expect(TRADE_FRAC).toBe(0.08);
    expect(KILL_FRAC).toBe(0.25);
    expect(roomBudget(snap())).toBe(8);
    expect(roomBudget(snap({ realizedToday: -23 }))).toBe(2);
    expect(roomBudget(snap({ realizedToday: -25 }))).toBe(0);
    expect(roomBudget(null)).toBe(0);
    expect(eng().check(intent({ count: 16 }), snap(), NOW).ok).toBe(true); // $8.00
    expect(eng().check(intent({ count: 17 }), snap(), NOW).why).toContain("pile room");
  });
  it("the day latches at −25% and open, resting and unconfirmed sends count at worst case", () => {
    const r = eng();
    expect(r.check(intent(), snap({ realizedToday: -20, openWorst: 2, restWorst: 1, pendingWorst: 2 }), NOW).why).toContain("daily stop latched");
    expect(r.check(intent(), snap(), NOW).why).toContain("daily stop latched"); // stays latched for the ET day
    expect(eng().check(intent(), snap({ realizedToday: -20, openWorst: 2, restWorst: 1 }), NOW).ok).toBe(true);
  });
  it("three losses in a row end the day; two do not", () => {
    const l = (i: number) => ({ ticker: T, pnl: -1, settledMs: NOW - 3_600_000 + i * 60_000 });
    expect(eng().check(intent(), snap({ settledToday: [l(0), l(1)] }), NOW).ok).toBe(true);
    expect(eng().check(intent(), snap({ settledToday: [l(0), l(1), l(2)] }), NOW).why).toContain("three losses");
  });
  it("price band, one order per ticker window, one order per tick, and cash", () => {
    expect(eng().check(intent({ price: PRICE_MIN - 0.01 }), snap(), NOW).why).toContain("band");
    expect(eng().check(intent({ price: PRICE_MAX + 0.01, count: 1 }), snap(), NOW).why).toContain("band");
    expect(eng().check(intent(), snap({ ordersPerTicker: { [T]: MAX_ORDERS_PER_TICKER_WINDOW } }), NOW).why).toContain("orders per ticker");
    const r = eng();
    r.consume(intent());
    expect(r.check(intent(), snap(), NOW).why).toContain("one order per tick");
    expect(eng().check(intent(), snap({ shard2Cash: 0.9 }), NOW).ok).toBe(false);
  });
  it("missing per-ticker or correlated maps refuse (fail closed)", () => {
    expect(eng().check(intent(), snap({ tickerWorst: undefined }), NOW).why).toContain("exposure maps missing");
    expect(eng().check(intent(), snap({ correlated: undefined }), NOW).why).toContain("exposure maps missing");
  });
  it("BTC+ETH+SOL on the same side share one budget; the other side does not", () => {
    const full = snap({ correlated: { "crypto|up": 7.5 } });
    expect(eng().check(intent(), full, NOW).why).toContain("correlated");
    expect(eng().check(intent({ ticker: "KXETH15M-26OCT081200-00", side: "no" }), full, NOW).ok).toBe(true);
  });
  it("another series in the same 15-minute window is allowed", () => {
    expect(eng().check(intent({ ticker: "KXETH15M-26OCT081200-00" }), snap({ tickerWorst: { [T]: 1 } }), NOW).ok).toBe(true);
  });
});
