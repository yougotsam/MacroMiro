import { describe, expect, it } from "bun:test";
import { bias, bracket, mayFire, pressPlan } from "./flip-plan";

describe("perp flip plan", () => {
  it("a long stop sits under the entry and the rest target is 2.5 times the risk", () => {
    const b = bracket(100, 96, "long");
    expect(b?.stop).toBe(96);
    expect(b?.takeHalf).toBe(104);
    expect(b?.takeRest).toBe(110);
  });

  it("funding that charges longs blocks the long", () => {
    expect(bias({ sweep: "low", gap: "yes", funding: 0.002, spread: 0.0002 })).toBeNull();
    expect(bias({ sweep: "low", gap: "yes", funding: 0, spread: 0.0002 })?.side).toBe("long");
  });

  it("a button press does not need a sweep, and it still refuses a stop that is too big", () => {
    const press = mayFire({
      ticker: "KXBTCPERP", side: "long", sweep: null, gap: null, funding: null, spread: null,
      pileUsd: 200, clipUsd: 40, stopLossPctOfClip: 15, downUsd: 0, lossesInARow: 0, clicked: true,
    });
    expect(press.ok).toBe(true);
    const fat = mayFire({
      ticker: "KXBTCPERP", side: "long", sweep: null, gap: null, funding: null, spread: null,
      pileUsd: 200, clipUsd: 200, stopLossPctOfClip: 50, downUsd: 0, lossesInARow: 0, clicked: true,
    });
    expect(fat.ok).toBe(false);
  });

  it("half is one risk-unit from the entry, not the midpoint of the target", () => {
    const p = pressPlan(100, "long", 2, 8, 2.5);
    expect(p?.stop).toBe(96);
    expect(p?.t1).toBe(104);
    expect(p?.t2).toBe(110);
  });
});
