import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tauricDebate } from "./tauric-debate.ts";

describe("bull bear", () => {
  it("kills a wide book and keeps a tight push", () => {
    const killed = tauricDebate({ ticker: "KXGOLDPERP", side: "bid", bid: 4000, ask: 4010, lev: 15, pushOverNoise: 3 });
    assert.equal(killed.ok, false);
    assert.match(killed.why, /bear/);
    const held = tauricDebate({ ticker: "KXBTCPERP", side: "bid", bid: 100000, ask: 100004, lev: 6.4, pushOverNoise: 2.4 });
    assert.equal(held.ok, true);
    assert.equal(held.limit, 100004);
  });
});
