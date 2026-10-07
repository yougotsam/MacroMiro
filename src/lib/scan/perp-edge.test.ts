import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluatePerpEdge } from "./edge.ts";

describe("pasted perp edge", () => {
  it("does not sit a wide book, and still keeps the -$24 shield and a whole contract floor", () => {
    const go = evaluatePerpEdge(
      {
        ticker: "KXGOLDPERP",
        markPrice: 4000,
        bidPrice: 3999,
        askPrice: 4001,
        indexPrice: 4000,
        spreadBps: 2,
        maxLeverage: 15.2,
        fundingRateBps: 0,
        dailyPnLUsd: 0,
      },
      { direction: "LONG", confidenceScore: 80, catalystAlert: false, primaryThesis: "up" },
      { selectedLeverage: 5, clipUsd: 25, tpMultiple: 2.5, slPercent: 8, tauricThreshold: 68 },
    );
    assert.equal(go.action, "EXECUTE");
    assert.ok(go.order);
    assert.ok(Number(go.order.count) < 1);
    assert.ok(Math.abs(go.order.requiredMarginUsd - 25) < 0.05);
    assert.ok(Math.abs(go.order.notionalUsd - 125) < 1);
    assert.equal(go.order.effectiveLeverage, 5);
    assert.equal(evaluatePerpEdge(
      {
        ticker: "KXGOLDPERP",
        markPrice: 4000,
        bidPrice: 3999,
        askPrice: 4001,
        indexPrice: 4000,
        spreadBps: 9,
        maxLeverage: 15.2,
        fundingRateBps: 0,
        dailyPnLUsd: 0,
      },
      { direction: "LONG", confidenceScore: 80, catalystAlert: false, primaryThesis: "up" },
      { selectedLeverage: 5, clipUsd: 25, tpMultiple: 2.5, slPercent: 8, tauricThreshold: 68 },
    ).action, "EXECUTE");
  });
});
