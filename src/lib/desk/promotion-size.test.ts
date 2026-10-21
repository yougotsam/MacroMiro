import { describe, expect, it } from "bun:test";
import { MODEL_VERSION } from "./config";
import type { PromotionDoc } from "../deskc/promotion";
import { promotionSize, setupName } from "./promotion-size";

const fee = { feeType: "quadratic", multiplier: 1 };

function doc(state: "ELIGIBLE" | "RESEARCH"): PromotionDoc {
  return {
    modelVersion: MODEL_VERSION,
    at: 1,
    setups: {
      "settlement-model": {
        state, why: state === "ELIGIBLE" ? "passed" : "n 0 < 300", n: state === "ELIGIBLE" ? 300 : 0,
        brier: 0.01, priceBrier: 0.02, ev: 0.02, fresh: true, beatsPrice: state === "ELIGIBLE", fills: 10, fillsPnl: 1,
      },
    },
  };
}

describe("promotion size", () => {
  it("a research setup keeps the flat count", () => {
    const r = promotionSize({
      doc: doc("RESEARCH"), setup: "settlement-model", flatCount: 6, flatFee: 0,
      price: 0.4, maker: true, fee, pSide: 0.55, flatBudget: 3, bankroll: 100,
    });
    expect(r.count).toBe(6);
    expect(r.why).toBe("research flat budget");
  });
  it("a missing file does not zero the flat order", () => {
    const r = promotionSize({
      doc: null, setup: "settlement-model", flatCount: 4, flatFee: 0,
      price: 0.5, maker: true, fee, pSide: 0.6, flatBudget: 3, bankroll: 100,
    });
    expect(r.count).toBe(4);
  });
  it("an eligible setup can size, and cannot exceed the flat budget", () => {
    const r = promotionSize({
      doc: doc("ELIGIBLE"), setup: "settlement-model", flatCount: 7, flatFee: 0,
      price: 0.4, maker: true, fee, pSide: 0.7, flatBudget: 3, bankroll: 100,
    });
    expect(r.count).toBeGreaterThan(0);
    expect(r.count * 0.4).toBeLessThanOrEqual(3 + 1e-9);
  });
  it("names the side that was bought, not the other side", () => {
    expect(setupName("no", { long: { setup: "TREND_PULLBACK" }, short: { setup: "NONE" } })).toBe("settlement-model");
    expect(setupName("yes", { long: { setup: "TREND_PULLBACK" }, short: { setup: "NONE" } })).toBe("TREND_PULLBACK");
  });
});
