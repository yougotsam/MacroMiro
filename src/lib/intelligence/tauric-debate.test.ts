import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateMarginRequirement } from "../scan/perp-margin.ts";
import { mathVerdict, runTauricDebate } from "./tauric-debate.ts";
import { sliderCeiling } from "../scan/perp-slider.ts";

describe("leverage ceiling", () => {
  it("turns thirty dollars into less notional when leverage drops", () => {
    const high = calculateMarginRequirement(4000, 15 * 30 / 4000, 15);
    const low = calculateMarginRequirement(4000, 5 * 30 / 4000, 5);
    assert.ok(Math.abs(high.requiredMargin - 30) < 0.01);
    assert.ok(Math.abs(low.requiredMargin - 30) < 0.01);
    assert.ok(low.liquidationBufferPercent > high.liquidationBufferPercent);
  });

  it("will not let the model exceed the slider", async () => {
    const ctx = {
      ticker: "KXGOLDPERP",
      spotPrice: 4000,
      bidPrice: 3999,
      askPrice: 4001,
      leverageMax: 15.2,
      selectedLeverage: 5,
      shortTermMomentum: 2.6,
    };
    const verdict = await runTauricDebate(ctx, async () =>
      JSON.stringify({
        action: "LONG",
        convictionScore: 80,
        recommendedLeverage: 15,
        bullThesis: "up",
        bearThesis: "wick",
        arbitratorReasoning: "too hot",
        stopLossPrice: 3900,
        takeProfitPrice: 4200,
      }),
    );
    assert.equal(verdict.action, "LONG");
    assert.ok(verdict.recommendedLeverage <= 5);
    const quiet = mathVerdict(ctx, "SHORT");
    assert.equal(quiet.recommendedLeverage, 5);
    assert.ok(quiet.stopLossPrice > 4000);
    assert.ok(sliderCeiling("KXETHPERP", 4.8) <= 4.8);
  });
});
