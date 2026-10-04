import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readSkill, type PxBar } from "./skill.ts";

function bar(o: number, h: number, l: number, c: number, v = 1): PxBar {
  return { o, h, l, c, v };
}

describe("skill layer", () => {
  it("does not turn a hammer or RSI into a thesis by itself", () => {
    const hammer = bar(0.5, 0.52, 0.4, 0.51);
    const flat = [bar(0.5, 0.51, 0.49, 0.5), bar(0.5, 0.51, 0.49, 0.5), bar(0.5, 0.51, 0.49, 0.5), bar(0.5, 0.51, 0.49, 0.5), hammer];
    const rsiOnly = readSkill({ bars: flat, rsi: 28, bookImb: 0, newsBlocked: false, engulf: null });
    assert.equal(rsiOnly.pattern, "hammer");
    assert.equal(rsiOnly.thesis, "meanrev");
    const rsiNoWick = readSkill({
      bars: [bar(0.4, 0.6, 0.4, 0.6), bar(0.6, 0.62, 0.58, 0.61), bar(0.61, 0.63, 0.6, 0.62), bar(0.62, 0.64, 0.61, 0.63), bar(0.63, 0.7, 0.62, 0.69)],
      rsi: 28,
      bookImb: null,
      newsBlocked: false,
      engulf: null,
    });
    assert.equal(rsiNoWick.thesis, "none");
  });

  it("news vetoes even when 1m and 5m agree", () => {
    const up = [bar(0.4, 0.45, 0.4, 0.44), bar(0.44, 0.48, 0.44, 0.47), bar(0.47, 0.5, 0.47, 0.49), bar(0.49, 0.53, 0.49, 0.52), bar(0.52, 0.58, 0.52, 0.57)];
    const s = readSkill({ bars: up, rsi: 60, bookImb: 0.4, newsBlocked: true, engulf: null });
    assert.equal(s.thesis, "news");
    assert.equal(s.veto, "news");
  });
});
