import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { notePerpPrice, perpCount, perpDecision, perpStops, pickLeverage } from "./perp-desk.ts";

describe("perp desk", () => {
  it("uses 3x or 5x unless the push is a sniper", () => {
    assert.equal(pickLeverage(15.2, 2.1), 3);
    assert.equal(pickLeverage(15.2, 2.5), 5);
    assert.equal(pickLeverage(15.2, 3.2), 15.2);
    assert.equal(pickLeverage(4.8, 2.5), 4.8);
  });

  it("needs three pushes and refuses a wide book", () => {
    const ticker = "KXGOLDPERP";
    const start = Date.UTC(2026, 9, 3, 12, 0);
    for (let i = 0; i < 6; i++) notePerpPrice(ticker, 4000 + i * 8, start + i * 60_000);
    const go = perpDecision(ticker, 4039, 4040, 15.27);
    assert.equal(go.take, true);
    assert.equal(go.side, "bid");
    assert.ok(go.useLev > 0 && go.useLev <= 15.27);
    const wide = perpDecision(ticker, 4000, 4020, 15.27);
    assert.equal(wide.take, false);
    assert.match(wide.why, /spread/);
    const count = perpCount(4040, 1, go.useLev, 30);
    assert.ok(count > 0);
    const stops = perpStops(4040, "bid", go.useLev);
    assert.ok(stops.stop < 4040 && stops.takeProfit > 4040);
  });
});
