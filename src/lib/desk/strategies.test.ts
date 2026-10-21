import { describe, expect, it } from "bun:test";
import { ema } from "./features";
import type { Bar } from "./features";
import { emaPullback, fibRetrace } from "./strategies";

function bar(t: number, o: number, h: number, l: number, c: number): Bar {
  return { t, o, h, l, c };
}

describe("Fibonacci retracement", () => {
  it("buys a pullback into the 38–62% zone of an up swing, and not a chase or a deep miss", () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 20; i += 1) {
      const px = 100 + i * (10 / 19);
      bars.push(bar(i, px - 0.05, i === 19 ? 110 : px + 0.15, i === 0 ? 100 : px - 0.05, px));
    }
    for (let i = 20; i < 29; i += 1) {
      const px = 110 - (i - 19) * 0.4;
      bars.push(bar(i, px + 0.1, px + 0.15, px - 0.05, px));
    }
    bars.push(bar(29, 104.6, 105.2, 104.4, 105));
    expect(fibRetrace(bars)).toMatchObject({ name: "FIB_RETRACE", side: "yes" });

    const chase = bars.slice(0, -1);
    chase.push(bar(29, 109, 109.6, 108.8, 109.4));
    expect(fibRetrace(chase)).toBeNull();

    const deep = bars.slice(0, -1);
    deep.push(bar(29, 102.2, 102.6, 102, 102.4));
    expect(fibRetrace(deep)).toBeNull();
  });

  it("does not take an upper wick as the long reaction", () => {
    const bars: Bar[] = [];
    for (let i = 0; i < 20; i += 1) {
      const px = 100 + i * (10 / 19);
      bars.push(bar(i, px, i === 19 ? 110 : px + 0.2, i === 0 ? 100 : px - 0.05, px));
    }
    for (let i = 20; i < 29; i += 1) bars.push(bar(i, 106, 106.2, 105.8, 106));
    bars.push(bar(29, 105.2, 106.4, 104.8, 105));
    expect(fibRetrace(bars)).toBeNull();
  });
});

describe("EMA pullback", () => {
  it("buys a touch of a rising 20-average and ignores a close that never came back to it", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.3);
    const bars = closes.map((c, t) => bar(t, c - 0.05, c + 0.1, c - 0.1, c));
    const e20 = ema(closes, 20)!;
    const tagged = bars.slice();
    const c = closes[59];
    tagged[59] = bar(59, e20 + 0.02, c + 0.1, e20 - 0.1, c);
    expect(emaPullback(tagged)).toMatchObject({ name: "EMA_PULLBACK", side: "yes" });
    expect(emaPullback(bars)).toBeNull();
  });
});
