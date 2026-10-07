import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tauricDebate } from "./tauric-debate.ts";

describe("bull bear", () => {
  it("does not kill a wide book when the push is there", () => {
    const wide = tauricDebate({ ticker: "KXGOLDPERP", side: "bid", bid: 4000, ask: 4010, lev: 15, pushOverNoise: 3 });
    assert.equal(wide.ok, true);
    assert.equal(wide.limit, 4010);
    const held = tauricDebate({ ticker: "KXBTCPERP", side: "bid", bid: 100000, ask: 100004, lev: 6.4, pushOverNoise: 2.4 });
    assert.equal(held.ok, true);
    assert.equal(held.limit, 100004);
  });
});
