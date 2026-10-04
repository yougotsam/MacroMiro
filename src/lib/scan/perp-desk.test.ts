import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { notePerpPrice, perpCount, perpDecision, perpStops } from "./perp-desk.ts";

describe("perp desk", () => {
  it("needs three pushes and refuses a wide book", () => {
    const ticker = "KXGOLDPERP";
    const start = Date.UTC(2026, 9, 3, 12, 0);
    for (let i = 0; i < 6; i++) notePerpPrice(ticker, 4000 + i * 8, start + i * 60_000);
    const go = perpDecision(ticker, 4039, 4040, 15.27);
    assert.equal(go.take, true);
    assert.equal(go.side, "bid");
    const wide = perpDecision(ticker, 4000, 4020, 15.27);
    assert.equal(wide.take, false);
    assert.match(wide.why, /spread/);
    const count = perpCount(4040, 1, 15.27, 30);
    assert.ok(count > 0);
    const stops = perpStops(4040, "bid", 15.27);
    assert.ok(stops.stop < 4040 && stops.takeProfit > 4040);
  });
});
