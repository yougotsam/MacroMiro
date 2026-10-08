import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shadowLanes, type ShadowFeatures } from "./shadow-lanes.ts";

const feat: ShadowFeatures = {
  ticker: "KXBTC15M-TEST",
  rsi: 55,
  bbWidth: 0.04,
  fibZone: "none",
  volume: 10,
  engulf: null,
  spread: 0.02,
  bookImb: 0.2,
  payoutX: 1.75,
  feeEst: 0.02,
  newsBlocked: false,
};

describe("shadow lanes do not trade", () => {
  it("baseline never takes", () => {
    const lanes = shadowLanes({ book: "btc", moveBps: 2, up: 0.55, winner: "up" }, feat);
    assert.equal(lanes.find((l) => l.id === "baseline")?.take, false);
    assert.equal(lanes.find((l) => l.id === "meanrev")?.take, false);
  });

  it("does not import order placement", () => {
    const src = readFileSync(new URL("./kalshi-shadow.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /placeEventOrder|submitBinary|kalshiPost|kalshiDelete/);
  });

  it("the live scan does not keep the old decider or the unused indicators", () => {
    const src = readFileSync(new URL("./kalshi.ts", import.meta.url), "utf8");
    assert.equal(src.includes("function decide("), false);
    assert.equal(src.includes("featuresOf"), false);
    assert.equal(src.includes("ema("), false);
  });
});
