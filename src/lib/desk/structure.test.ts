import { describe, expect, it } from "bun:test";
import { FEATURE_MAX_SHIFT, LOGIT_HIGH, PRICE_MAX, PRICE_MIN } from "./config";
import { applyLogit, ema200Side, featureShift, features, technicalSide, tradeLogit, type FeatureSnapshot } from "./features";

function frame(over: Partial<FeatureSnapshot> = {}): FeatureSnapshot {
  return {
    bars: 30,
    ema7: 101,
    ema14: 100,
    ema20: 100,
    ema50: 99,
    ema200: 98,
    rsi14: 55,
    ret5mBps: 2,
    candle: "none",
    structure: "none",
    groups: { trend: 1, momentum: 0.2, structure: 0, candle: 0 },
    score: 0.3,
    ...over,
    flow: over.flow ?? null,
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
  it("an RSI extreme does not open a trade", () => {
    const s = technicalSide(frame({ rsi14: 28, candle: "lower_wick", ema20: 110 }), 90, 100);
    expect(s.side).toBeNull();
    expect(s.why).toBe("no structure");
    expect(technicalSide(frame({ rsi14: 74, candle: "bear_engulf" }), 105, 100).side).toBeNull();
  });

  it("a sweep of the lows is a yes", () => {
    const s = technicalSide(frame({ structure: "sweep_low" }), 100, 101);
    expect(s.side).toBe("yes");
    expect(s.why).toBe("liquidity sweep of the lows");
  });

  it("an upper wick is not an entry, even on a demand tag or an overbought fade", () => {
    expect(technicalSide(frame({ candle: "upper_wick", structure: "demand" }), 100, 101).side).toBeNull();
    expect(technicalSide(frame({ candle: "upper_wick", rsi14: 74 }), 105, 100).why).toBe("upper wick is not an entry");
  });

  it("a return into demand is a yes", () => {
    const s = technicalSide(frame({ structure: "demand" }), 100, 101);
    expect(s.side).toBe("yes");
  });

  it("a sweep of the highs is a no", () => {
    const s = technicalSide(frame({ structure: "sweep_high" }), 100, 99);
    expect(s.side).toBe("no");
  });

  it("the 200 EMA: last close above is yes, below is no, equal or unread is not a pass", () => {
    expect(ema200Side(101, 100)).toBe("yes");
    expect(ema200Side(99, 100)).toBe("no");
    expect(ema200Side(100, 100)).toBeNull();
    expect(ema200Side(101, null)).toBeNull();
    const short = Array.from({ length: 199 }, (_, i) => ({ t: i, o: 1, h: 1, l: 1, c: 100 }));
    expect(features(short).ema200).toBeNull();
    const long = [...short, { t: 199, o: 1, h: 1, l: 1, c: 130 }];
    const e = features(long).ema200;
    expect(e).not.toBeNull();
    expect(ema200Side(130, e)).toBe("yes");
  });

  it("a score of 11 adds a logit of 0.80 and the band is 36¢ to 95¢", () => {
    expect(LOGIT_HIGH).toBe(0.8);
    expect(tradeLogit(0.8, 0, 1).step).toBe(0.8);
    expect(tradeLogit(0, 11, 1).delta).toBe(0.8);
    expect(tradeLogit(0.5, 0, 1).step).toBe(0.45);
    expect(applyLogit(0.5, 0.8)).toBeCloseTo(0.6899, 3);
    expect(PRICE_MIN).toBe(0.36);
    expect(PRICE_MAX).toBe(0.95);
    expect(Math.abs(featureShift(0.5, 1))).toBeLessThanOrEqual(0.04 + 1e-9);
  });
});
