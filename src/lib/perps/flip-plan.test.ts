import { describe, expect, it } from "bun:test";
import { bias, bracket } from "./flip-plan";

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
});
