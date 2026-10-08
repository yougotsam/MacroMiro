import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

describe("GET /api/live/heart is read-only", () => {
  it("route GET never calls executeHeart or placeEventOrder", () => {
    const src = readFileSync(new URL("../../routes/api/live/heart.ts", import.meta.url), "utf8");
    const getBlock = src.slice(src.indexOf("GET:"), src.indexOf("POST:"));
    assert.match(getBlock, /loadHeart\(\)/);
    assert.doesNotMatch(getBlock, /tickHeart/);
    assert.doesNotMatch(getBlock, /executeHeart/);
    assert.doesNotMatch(getBlock, /placeEventOrder/);
    assert.doesNotMatch(getBlock, /submitBinary/);
    assert.doesNotMatch(getBlock, /kalshiDelete/);
    assert.doesNotMatch(getBlock, /kalshiPost/);
  });

  it("heart tick is scan-only: no order, cancel, or execute path left in the heart", () => {
    const src = readFileSync(new URL("./heart.server.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /submitBinary|placeEventOrder|kalshiPost|kalshiDelete|kalshi-order"|executeHeart|watchRest/);
    assert.doesNotMatch(src, /setArmedKill\(true, "begin file on"\)/);
  });
});
