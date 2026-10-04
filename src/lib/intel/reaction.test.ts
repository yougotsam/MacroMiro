import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pctAfter, sayMove } from "./reaction.ts";

describe("price reaction", () => {
  const bars = [
    { t: 0, c: 100 },
    { t: 60_000, c: 101 },
    { t: 15 * 60_000, c: 98 },
    { t: 60 * 60_000, c: 110 },
  ];
  it("measures the close after the event and refuses a missing bar", () => {
    assert.equal(pctAfter(bars, 0, 60_000)?.toFixed(2), "1.00");
    assert.equal(pctAfter(bars, 0, 15 * 60_000)?.toFixed(2), "-2.00");
    assert.equal(pctAfter(bars, 0, 5 * 60_000), null);
    assert.match(sayMove("BTC", null, "5m"), /not in the price feed/);
    assert.match(sayMove("Gold", 1.2, "1h"), /\+1.20%/);
  });
});
