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

  it("tickHeartInner only submits inside canExecute", () => {
    const src = readFileSync(new URL("./heart.server.ts", import.meta.url), "utf8");
    assert.match(src, /const canExecute = execute && liveExecutionAllowed\(\)/);
    const submitAt = src.indexOf("submitBinary(");
    const guardAt = src.lastIndexOf("if (canExecute && blocked.ok)", submitAt);
    assert.ok(guardAt >= 0 && guardAt < submitAt);
  });
});
