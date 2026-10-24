import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { notePerpPrice, perpCount, perpDecision, perpStops, pickLeverage } from "./perp-desk.ts";

describe("perp desk", () => {
  it("uses at most 5x and never the contract max", () => {
    assert.equal(pickLeverage(15.2, 1.5), 0);
    assert.equal(pickLeverage(15.2, 2.5), 5);
    assert.equal(pickLeverage(15.2, 3.2), 5);
    assert.equal(pickLeverage(2.5, 2.5), 2.5);
  });

  it("needs three pushes, a known funding rate, and sits a wide book", () => {
    const ticker = "KXGOLDPERP";
    const start = Date.UTC(2026, 9, 3, 12, 0);
    for (let i = 0; i < 6; i++) notePerpPrice(ticker, 4000 + i * 8, start + i * 60_000);
    const unread = perpDecision(ticker, 4039, 4040, 15.27);
    assert.equal(unread.take, false);
    assert.match(unread.why, /funding/);
    const go = perpDecision(ticker, 4039, 4040, 15.27, 0);
    assert.equal(go.take, true);
    assert.equal(go.side, "bid");
    assert.equal(go.authorizesOrder, false);
    assert.ok(go.useLev > 0 && go.useLev <= 5);
    const wide = perpDecision(ticker, 4000, 4020, 15.27, 0);
    assert.equal(wide.take, false);
    assert.match(wide.why, /spread/);
    const paying = perpDecision(ticker, 4039, 4040, 15.27, 0.001);
    assert.equal(paying.take, false);
    assert.match(paying.why, /funding charges longs/);
    const count = perpCount(4040, 1, go.useLev, 30);
    assert.ok(count > 0);
    const stops = perpStops(4040, "bid", go.useLev);
    assert.ok(stops.stop < 4040 && stops.takeProfit > 4040);
  });
});
