import { describe, expect, it } from "bun:test";
import { evaluateSniper } from "../desk/sniper";
import { confluenceLog } from "../desk/evaluator";
import { selectResidual, type AnchorRow } from "./anchor";
import { seriesWindows } from "./exclusion";
import { scoreableDecisions, type RawDecision } from "./retro";
import type { DecisionRow } from "./scorecard";

describe("setup none", () => {
  it("a one-hour index cannot name a setup", () => {
    const sniper = { long: evaluateSniper([], [], "long", true), short: evaluateSniper([], [], "short", true) };
    const log = confluenceLog(sniper);
    expect(log?.long.setup).toBe("NONE");
    expect(log?.long.score).toBe(0);
    expect(log?.block).toBe("60 complete 15m bars");
  });
});

describe("scoreable decisions", () => {
  it("keeps every priced print on a settled contract", () => {
    const decisions: RawDecision[] = [0, 1, 2].map((i) => ({
      ts: new Date(1_700_000_000_000 + i * 1000).toISOString(),
      ticker: "KXBTC15M-TEST",
      series: "KXBTC15M",
      close: new Date(1_700_000_900_000).toISOString(),
      tte_s: 90 - i,
      p: 0.6,
      quotes: { yes_bid: 0.4, yes_ask: 0.42 },
    }));
    decisions.push({ ts: new Date().toISOString(), ticker: "KXBTC15M-OPEN", series: "KXBTC15M", p: 0.6, quotes: { yes_bid: 0.4, yes_ask: 0.42 } });
    const out = scoreableDecisions(decisions, new Map([["KXBTC15M-TEST", "yes"]]));
    expect(out.rows).toHaveLength(3);
    expect(out.dropped.no_settlement).toBe(1);
  });
});

describe("price anchor", () => {
  it("drops a feature that does not beat the price, and keeps one that does", () => {
    const noise: AnchorRow[] = Array.from({ length: 120 }, (_, i) => ({
      expiryMs: i * 60_000,
      y: (i % 2) as 0 | 1,
      price: i % 2 === 0 ? 0.8 : 0.2,
      features: { noise: 1 },
    }));
    const bad = selectResidual(noise, 40);
    expect(bad.kept).not.toContain("noise");
    expect(bad.beatsPrice).toBe(false);

    const good: AnchorRow[] = Array.from({ length: 120 }, (_, i) => {
      const y: 0 | 1 = i % 2 === 0 ? 1 : 0;
      return { expiryMs: i * 60_000, y, price: 0.5, features: { tell: y === 1 ? 1 : -1 } };
    });
    const fit = selectResidual(good, 40);
    expect(fit.kept).toContain("tell");
    expect(fit.beatsPrice).toBe(true);
    expect(fit.modelBrier).toBeLessThan(fit.priceBrier);
  });
});

describe("series window", () => {
  it("excludes only a window that lost money", () => {
    const row = (series: string, tte: number, pnl: number): DecisionRow => ({
      at: 1, expiryMs: 1, series, setup: "settlement-model", modelPYes: 0.5, yesPrice: 0.5,
      edge: 0, mode: "none", featureHash: series, settledYes: 1, pnlAfterFees: pnl, fresh: true, tteSec: tte, filled: false,
    });
    const rows = [...Array.from({ length: 15 }, () => row("KXGOLD15M", 40, -0.03)), ...Array.from({ length: 15 }, () => row("KXBTC15M", 40, 0.02))];
    const xs = seriesWindows(rows);
    expect(xs.find((x) => x.series === "KXGOLD15M")?.excluded).toBe(true);
    expect(xs.find((x) => x.series === "KXBTC15M")?.excluded).toBe(false);
  });
});
