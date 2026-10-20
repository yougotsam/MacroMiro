import { describe, expect, it } from "bun:test";
import { FEATURE_MAX_SHIFT } from "./config";
import { featureShift, technicalSide, type FeatureSnapshot } from "./features";

function frame(over: Partial<FeatureSnapshot> = {}): FeatureSnapshot {
  return {
    bars: 30,
    ema7: 101,
    ema14: 100,
    ema20: 100,
    ema50: 99,
    rsi14: 55,
    ret5mBps: 2,
    candle: "none",
    structure: "none",
    groups: { trend: 1, momentum: 0.2, structure: 0, candle: 0 },
    score: 0.3,
    ...over,
  };
}

describe("structure must agree before a side is allowed", () => {
  it("price above the 20-minute average is not a trade", () => {
    const s = technicalSide(frame(), 105, 100);
    expect(s.side).toBeNull();
    expect(s.why).toBe("no structure");
  });

  it("an overbought reading without a pullback is not a trade", () => {
    const s = technicalSide(frame({ rsi14: 74 }), 105, 100);
    expect(s.side).toBeNull();
  });

  it("a fib pocket with only the average under price is not a trade", () => {
    const s = technicalSide(frame({ structure: "ote_long", candle: "none" }), 105, 100);
    expect(s.side).toBeNull();
    expect(s.why).toBe("fib pocket needs a reaction");
  });

  it("a fib pocket with a bullish wick is yes", () => {
    const s = technicalSide(frame({ structure: "ote_long", candle: "lower_wick" }), 105, 100);
    expect(s.side).toBe("yes");
    expect(s.why).toBe("fib pocket long");
  });
  it("an RSI bounce with a bullish wick is yes even below the line", () => {
    const s = technicalSide(frame({ rsi14: 28, candle: "lower_wick", ema20: 110 }), 90, 100);
    expect(s.side).toBe("yes");
  });

  it("a sweep of the lows is a yes", () => {
    const s = technicalSide(frame({ structure: "sweep_low" }), 100, 101);
    expect(s.side).toBe("yes");
    expect(s.why).toBe("liquidity sweep of the lows");
  });

  it("a return into demand is a yes", () => {
    const s = technicalSide(frame({ structure: "demand" }), 100, 101);
    expect(s.side).toBe("yes");
  });

  it("a sweep of the highs is a no", () => {
    const s = technicalSide(frame({ structure: "sweep_high" }), 100, 99);
    expect(s.side).toBe("no");
  });

  it("the technical score can move the chance, and not by more than 4 points", () => {
    expect(FEATURE_MAX_SHIFT).toBe(0.04);
    expect(featureShift(0.5, 1)).toBeCloseTo(0.04);
    expect(featureShift(0.5, 0)).toBe(0);
  });
});
