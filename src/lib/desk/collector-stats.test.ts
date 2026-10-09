import { describe, expect, it } from "bun:test";
import { collectorStats } from "./collector-stats";

const row = (ticker: string, close: string, complete = true) => ({ ticker, series: ticker.split("-")[0], close, exec: { complete, yes_bid: 0.4, yes_ask: 0.43 }, rejected: true, failed_gate: "G2_no_edge" });
describe("collector stats", () => {
  it("counts scans, unique markets, independent windows and crypto correlation separately", () => {
    const rows = [row("KXBTC15M-A-00", "w1"), row("KXBTC15M-A-00", "w1"), row("KXETH15M-A-00", "w1"), row("KXGOLD15M-A-00", "w1"), row("KXBTC15M-B-00", "w2"), row("KXETH15M-B-00", "w2", false)];
    const outs = [
      { ticker: "KXBTC15M-A-00", series: "KXBTC15M", close: "w1", result: "yes" }, { ticker: "KXETH15M-A-00", series: "KXETH15M", close: "w1", result: "yes" },
      { ticker: "KXGOLD15M-A-00", series: "KXGOLD15M", close: "w1", result: "no" }, { ticker: "KXBTC15M-B-00", series: "KXBTC15M", close: "w2", result: "no" },
      { ticker: "KXETH15M-B-00", series: "KXETH15M", close: "w2", result: "yes" },
    ];
    const s = collectorStats(rows, outs, 0);
    expect(s.repeatedScans.rows).toBe(6);
    expect(s.repeatedScans.perTickerMax).toBe(2);
    expect(s.uniqueMarkets.observed).toBe(5);
    expect(s.uniqueMarkets.completeExecutableQuotes).toBe(4);
    expect(s.uniqueMarkets.settledWithCompleteQuotes).toBe(4); // ETH-B lacked a complete quote
    expect(s.independentClosingWindows.completed).toBe(2);
    expect(s.independentClosingWindows.remaining).toBe(198);
    expect(s.correlatedOutcomes.cryptoWindows).toBe(1); // w2 has only one crypto contract with a complete quote
    expect(s.correlatedOutcomes.pairwiseAgreement).toBe(1);
    expect(s.medianYesSpreadBySeries.KXBTC15M).toBe(0.03);
    expect(s.rejectedByGate.G2_no_edge).toBe(6);
  });
});

describe("independent clusters and quote completeness (round 3.3)", () => {
  const close = "2026-10-09T21:00:00.000Z";
  const full = (series: string, idx = true) => ({
    ticker: `${series}-26OCT091700-00`, series, close, exec: { complete: true, yes_bid: 0.4, yes_ask: 0.41, no_bid: 0.59, no_ask: 0.6, yes_ask_size: 10, no_ask_size: 12 },
    threshold: { strike: 100 }, index: idx ? { value: 100, age_ms: 900 } : { value: null, age_ms: 10_000_000 }, fee_type: "quadratic", fee_multiplier: 1,
  });
  const out = (series: string, result = "yes") => ({ ticker: `${series}-26OCT091700-00`, series, close, result });
  it("four coins at one settlement time are ONE crypto cluster; gold is its own", () => {
    const rows = ["KXBTC15M", "KXETH15M", "KXSOL15M", "KXXRP15M", "KXGOLD15M"].map((s) => full(s));
    const st = collectorStats(rows, rows.map((r) => out(r.series)));
    expect(st.independentClusters.crypto.settled).toBe(1);
    expect(st.independentClusters.gold.settled).toBe(1);
    expect(st.independentClusters.settlementTimes).toBe(1);
    expect(st.completeness.rowsAllFieldsPct).toBe(100);
  });
  it("a stale/missing index or a missing outcome makes the row incomplete", () => {
    const rows = [full("KXBTC15M", false), full("KXETH15M")];
    const st = collectorStats(rows, [out("KXBTC15M")]);
    expect(st.completeness.rowsPctByField.index).toBe(50);
    expect(st.completeness.rowsPctByField.outcome).toBe(50);
    expect(st.completeness.rowsAllFieldsPct).toBe(0);
    expect(st.independentClusters.crypto.withAnyCompleteMarket).toBe(0);
  });
});

describe("settlementCluster", () => {
  it("crypto tickers at one close share a cluster; gold does not", async () => {
    const { settlementCluster } = await import("./calibration");
    const t = Date.parse("2026-10-09T21:00:00Z");
    expect(settlementCluster(t, "KXBTC15M-x")).toBe(settlementCluster(t, "KXXRP15M"));
    expect(settlementCluster(t, "KXGOLD15M")).not.toBe(settlementCluster(t, "KXBTC15M"));
    expect(settlementCluster(t + 900_000, "KXBTC15M")).not.toBe(settlementCluster(t, "KXBTC15M"));
  });
});
