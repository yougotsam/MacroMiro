import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARGIN_ENDPOINTS, resolveMarginHosts } from "./venue-config";
import { calculatePerpPnl, estimatePerpPnl, feeForFill } from "./economics";
import { LocalBook, SeqTracker } from "./stream";
import { replayBooks } from "./book-replay";
import { fundingClocksInHold, nextKalshiFundingMs } from "./sim";
import { perpsReader } from "./kalshi-perps-read";
import { PerpsOms, FakeExchange } from "./oms";

describe("perps foundation invariants", () => {
  it("uses the documented production and demo margin hosts", () => {
    expect(resolveMarginHosts({}).rest).toBe("https://external-api.kalshi.com");
    expect(resolveMarginHosts({ KALSHI_PERPS_ENV: "demo" }).rest).toBe("https://external-api.demo.kalshi.co");
    expect(MARGIN_ENDPOINTS.production.userWs).toBe("wss://margin-user-ws.kalshi.com");
  });
  it("rejects invalid and crossed margin environments", () => {
    expect(() => resolveMarginHosts({ KALSHI_PERPS_ENV: "other" })).toThrow();
    expect(() => resolveMarginHosts({ KALSHI_PERPS_HOST: "http://invalid.test" })).toThrow();
    expect(() => resolveMarginHosts({ KALSHI_PERPS_ENV: "demo", KALSHI_PERPS_HOST: MARGIN_ENDPOINTS.production.rest })).toThrow();
  });
  it("keeps prediction and margin write hosts separate", () => {
    const writer = readFileSync(new URL("../desk/oms.ts", import.meta.url), "utf8");
    const transport = readFileSync(new URL("./live-transport.ts", import.meta.url), "utf8");
    expect(writer).toContain('path.startsWith("/trade-api/v2/margin/") ? MARGIN_HOSTS.rest');
    expect(writer).toContain("const host = MARGIN_HOSTS.rest");
    expect(transport).not.toContain("KALSHI_HOST");
  });
  it("refuses a disabled margin account without further probes", async () => {
    const checks: string[] = [];
    const result = await perpsReader(async path => { checks.push(path); return { enabled: false }; }).capabilityProbe();
    expect(result.ready).toBe(false);
    expect(checks).toEqual(["/enabled"]);
  });
  it("refuses missing exchange status and unknown account data", async () => {
    const result = await perpsReader(async path => {
      if (path === "/enabled") return { enabled: true };
      if (path === "/exchange/status") return { exchange_active: true, trading_active: false };
      return {};
    }).capabilityProbe();
    expect(result.ready).toBe(false);
    expect(result.reasons).toContain("exchange_not_trading");
  });
  it("captures probe failure without opening any order path", async () => {
    const result = await perpsReader(async () => { throw Error("account unavailable"); }).capabilityProbe();
    expect(result.ready).toBe(false);
    expect(result.reasons).toContain("capability_probe_failed");
  });
  it("requires verified fee, balance and risk inputs", async () => {
    const result = await perpsReader(async path => {
      if (path === "/enabled") return { enabled: true };
      if (path === "/exchange/status") return { exchange_active: true, trading_active: true };
      if (path === "/risk_parameters") return { liquidation_margin_ratio_threshold: 0.8 };
      if (path === "/fee_tiers") return { maker_fee_rates: { KXBTCPERP: 0.0005 }, taker_fee_rates: { KXBTCPERP: 0.0012 } };
      if (path.startsWith("/balance")) return { account_equity: "120" };
      throw Error(path);
    }).capabilityProbe();
    expect(result.ready).toBe(true);
  });
  it("uses local receive time even when venue timestamp decreases", () => {
    const b = new LocalBook();
    b.snapshot({ bid: [["7", "3"]], ask: [["8", "5"]] }, 1, 1000);
    expect(b.delta({ side: "bid", price: "7", delta: "2", ts_ms: 900 }, 1100)).toBe(true);
    expect(b.delta({ side: "ask", price: "8", delta: "-2", ts_ms: 100 }, 1200)).toBe(true);
    expect(b.updatedMs).toBe(1200);
    expect(b.venueTsMs).toBe(100);
  });
  it("tracks subscription order independent of venue timestamps", () => {
    const seq = new SeqTracker();
    expect(seq.ok(9, 1)).toBe(true);
    expect(seq.ok(9, 2)).toBe(true);
    expect(seq.ok(9, 4)).toBe(false);
  });
  it("replacement snapshots discard previous levels", () => {
    const base = { market_ticker: "BTC", sid: 1, venueTs: 2, rx: 200 };
    const b = replayBooks([
      { ...base, kind: "orderbook_snapshot", seq: 1, bid: [["5", "1"]], ask: [["6", "1"]] },
      { ...base, kind: "orderbook_delta", seq: 2, price: "5", delta: "1", side: "bid" },
      { ...base, kind: "orderbook_snapshot", seq: 3, bid: [["4", "1"]], ask: [["6", "1"]] },
    ], { tradingActive: true });
    expect(b.books.BTC.bids).toEqual([[4, 1]]);
  });
  it("gaps invalidate every book on the affected subscription", () => {
    const x = replayBooks([
      { kind: "orderbook_snapshot", sid: 9, seq: 1, rx: 10, venueTs: 8, market_ticker: "BTC", bid: [["1", "1"]], ask: [["2", "1"]] },
      { kind: "orderbook_snapshot", sid: 9, seq: 2, rx: 11, venueTs: 8, market_ticker: "ETH", bid: [["3", "1"]], ask: [["4", "1"]] },
      { kind: "orderbook_delta", sid: 9, seq: 4, rx: 12, venueTs: 1, market_ticker: "BTC", side: "bid", price: "1", delta: "1" },
    ], { tradingActive: true });
    expect(x.gaps).toBe(1);
    expect(x.books.BTC.executable).toBe(false);
    expect(x.books.ETH.executable).toBe(false);
  });
  it("preserves long losses and short profits on a falling market", () => {
    const fills = { entryFills: [{ price: "10", qty: "2", feeUsd: "0" }], exitFills: [{ price: "9", qty: "2", feeUsd: "0" }] };
    expect(calculatePerpPnl({ direction: "long", ...fills }).netUsd).toBe(-2);
    expect(calculatePerpPnl({ direction: "short", ...fills }).netUsd).toBe(2);
  });
  it("adds partial exits, funding and per-fill fees exactly once", () => {
    const p = calculatePerpPnl({ direction: "long",
      entryFills: [{ price: 10, qty: 2, feeUsd: "0.01" }],
      exitFills: [{ price: 12, qty: 1, feeUsd: "0.01" }, { price: 11, qty: 1, feeUsd: "0.01" }],
      fundingPaymentsUsd: ["-0.05", "0.02"] });
    expect(p.grossUsd).toBe(3);
    expect(p.feesUsd).toBe(0.03);
    expect(p.netUsd).toBe(2.94);
  });
  it("rejects unclosed or non-positive filled quantities", () => {
    expect(() => calculatePerpPnl({ direction: "long",
      entryFills: [{ price: 10, qty: 2, feeUsd: 0 }],
      exitFills: [{ price: 11, qty: 1, feeUsd: 0 }] })).toThrow("not fully closed");
    expect(() => calculatePerpPnl({ direction: "long",
      entryFills: [{ price: 10, qty: 2, feeUsd: 0 }],
      exitFills: [{ price: 11, qty: 0, feeUsd: 0 }] })).toThrow();
  });
  it("supports fractional quantities, exact fee rounding and spread-inclusive fills", () => {
    expect(feeForFill("1", "1", "0.005")).toBe(0.005);
    const result = estimatePerpPnl({ direction: "long",
      entries: [{ price: "10", qty: "0.5", rate: "0.001" }],
      exits: [{ price: "11", qty: "0.5", rate: "0.001" }] });
    expect(result.grossUsd).toBe(0.5);
    expect(result.feesUsd).toBe(0.0105);
    expect(result.netUsd).toBe(0.4895);
  });
  it("uses Eastern-time crypto funding dates, including winter DST", () => {
    expect(nextKalshiFundingMs(Date.parse("2026-01-15T04:00:00Z"))).toBe(Date.parse("2026-01-15T05:00:00Z"));
    expect(nextKalshiFundingMs(Date.parse("2026-07-15T03:00:00Z"))).toBe(Date.parse("2026-07-15T04:00:00Z"));
    expect(fundingClocksInHold(Date.parse("2026-01-15T04:30:00Z"), 31 * 60_000))
      .toEqual([Date.parse("2026-01-15T05:00:00Z")]);
  });
});

describe("durable kill behavior (fake venue only)", () => {
  it("latches before network and retains protective stops if it cannot flatten", async () => {
    const dir = mkdtempSync(join(tmpdir(), "miro-stop-"));
    try {
      const venue = new FakeExchange();
      venue.applyFill("external", "KXBTCPERP", "bid", 2, 8.3, true);
      venue.triggers.push({ ticker: "KXBTCPERP", body: { stop_loss_price: 8.1 } });
      const path = join(dir, "journal.jsonl"), oms = new PerpsOms(venue, path, true);
      expect((await oms.killAndFlatten("op", "op", {}, "kill1")).ok).toBe(false);
      expect(venue.triggers).toHaveLength(1);
      expect(new PerpsOms(venue, path, true).blocked).toContain("KILL");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it("verifies flat position before clearing stops", async () => {
    const venue = new FakeExchange();
    venue.applyFill("external", "KXGOLDPERP", "bid", 3, 10, true);
    venue.triggers.push({ ticker: "KXGOLDPERP", body: { stop_loss_price: 9 } });
    const oms = new PerpsOms(venue, null, true);
    const done = await oms.killAndFlatten("op", "op", { KXGOLDPERP: { bestBid: 10, bestAsk: 10.01 } }, "kill2");
    expect(done.ok).toBe(true);
    expect(Number((await venue.positions())[0].position)).toBe(0);
    expect(venue.triggers).toHaveLength(0);
    expect(oms.blocked).toContain("KILL");
  });
  it("rejects unauthenticated kills", async () => {
    const venue = new FakeExchange(), oms = new PerpsOms(venue, null, true);
    expect((await oms.killAndFlatten("bad", "operator", {}, "kill")).ok).toBe(false);
    expect(oms.rows).toHaveLength(0);
  });
});
