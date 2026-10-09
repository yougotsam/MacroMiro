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
