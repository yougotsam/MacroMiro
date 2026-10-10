import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { settle, entryCost, sizeFor } from "./pnl";
import { candidatesOf, CONFIGS, type ObsRow } from "./candidates";
import { availableAt, pricedIn, evaluateEvent, type IntelEvent } from "./intel-events";
import { dayFiles, readJsonlFiles } from "./files";

describe("paper P&L in USD", () => {
  it("winning NO: 4 @ $0.66, fee $0.0629, payout $4 → +$1.2971 (real collector example)", () => {
    const r = settle({ side: "no", price: 0.66, qty: 4, feeMultiplier: 1 }, "no");
    expect(r.cost).toBe(2.64); expect(r.fee).toBe(0.0629); expect(r.payout).toBe(4); expect(r.net).toBe(1.2971);
  });
  it("losing YES: 10 @ $0.30 loses cost + fee", () => {
    const r = settle({ side: "yes", price: 0.3, qty: 10, feeMultiplier: 1 }, "no");
    expect(r.fee).toBe(0.147); expect(r.net).toBe(-3.147); expect(r.won).toBe(false);
  });
  it("fee is Kalshi's quadratic formula rounded up to the cent grid", () => {
    expect(entryCost({ side: "yes", price: 0.5, qty: 1, feeMultiplier: 1 }).fee).toBe(0.0175);
    expect(entryCost({ side: "yes", price: 0.97, qty: 3, feeMultiplier: 1 }).fee).toBe(0.0062);
  });
  it("size respects the $3 per-ticker cap including fee, and displayed depth", () => {
    expect(sizeFor(0.66, 7991, 3)).toBe(4);
    expect(sizeFor(0.14, 5, 3)).toBe(5);
    expect(sizeFor(0.99, 0.4, 3)).toBe(0);
    const q = sizeFor(0.14, 1000, 3);
    expect(q * 0.14 + entryCost({ side: "yes", price: 0.14, qty: q, feeMultiplier: 1 }).fee).toBeLessThanOrEqual(3);
  });
});

const row: ObsRow = { ts: "2026-10-10T12:00:00Z", ticker: "KXBTC15M-X", series: "KXBTC15M", close: "2026-10-10T12:15:00Z", tte_s: 500, strike: 100, spot: 101, p: 0.6, fee_multiplier: 1, failed_gate: "G2_no_edge",
  exec: { yes_ask: 0.5, yes_ask_size: 100, no_ask: 0.52, no_ask_size: 100, yes_bid: 0.48, no_bid: 0.5 }, confluence: { long: { score: 8, setup: "TREND_PULLBACK", eligible: false }, short: { score: 2, setup: "NONE", eligible: false } }, approval: null };

describe("paper candidates", () => {
  it("produce both sides with the full field list, labelled EXPERIMENTAL/UNCALIBRATED", () => {
    const [yes, no] = candidatesOf(row, null);
    expect(yes.side).toBe("yes"); expect(no.side).toBe("no");
    expect(yes.calibration).toMatch(/UNCALIBRATED/); expect(yes.calibratedProb).toBeNull();
    expect(yes.qty).toBe(5); expect(yes.evUsd).toBeCloseTo(5 * 0.1 - yes.fee, 4);
    for (const k of ["entryPrice", "availableQty", "strike", "tteSec", "structure", "setups", "confluence", "modelProbExperimental", "kalshiImplied", "evUsd", "plan", "deskGate", "weights"]) expect(yes).toHaveProperty(k);
    expect(yes.score).toBeGreaterThan(no.score);
  });
  it("no candidate without a model probability or quotes", () => {
    expect(candidatesOf({ ...row, p: null }, null)).toEqual([]);
    expect(candidatesOf({ ...row, exec: null }, null)).toEqual([]);
  });
  it("configs are paper rules only", () => expect(CONFIGS.map((c) => c.id)).toContain("C_research"));
});

const ev: IntelEvent = { id: "e", title: "t", url: "https://x", source: "s", assets: ["XRP"], publishedAt: "2026-10-09T06:00:00Z", detectedAt: "2026-10-10T00:15:00Z", direction: null, credits: 0 };
describe("intelligence-event evaluator", () => {
  it("never marks info available before we detected it (publication is not availability)", () => {
    expect(availableAt(ev, "2026-10-09T12:00:00Z").available).toBe(false);
    expect(availableAt(ev, "2026-10-10T00:16:00Z").available).toBe(true);
  });
  it("does not assert 'priced in' without market evidence", () => {
    expect(pricedIn(ev, []).verdict).toBe("unknown");
    expect(evaluateEvent(ev, "2026-10-09T12:00:00Z", []).usableDirection).toBeNull();
  });
});

describe("files + isolation", () => {
  it("missing folders give empty lists, not crashes", () => {
    expect(dayFiles("/nonexistent/dir", "observations-")).toEqual([]);
    expect(readJsonlFiles(["/nonexistent/x.jsonl"])).toEqual([]);
  });
  it("paper code cannot reach orders", () => {
    const files = [...readdirSync(new URL(".", import.meta.url)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => new URL(f, import.meta.url)), new URL("../../../scripts/paper/run.ts", import.meta.url)];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/from\s+"[^"]*(oms|engine|order|kalshi-write|switch|kill)[^"]*"/i);
      expect(src).not.toMatch(/placeEventOrder|createOrder|cancelOrder|\/portfolio\/orders/);
    }
  });
});
