import { describe, expect, it } from "bun:test";
import { guardVerdict } from "./guard";

describe("guard", () => {
  it("a named side still does not fire without a review and a measured probability", () => {
    const v = guardVerdict({ side: "yes", cash: 150, dayWorst: 0, kept: false, calibratedP: null });
    expect(v.setup_q).toBe(2);
    expect(v.fire).toBe(false);
    expect(v.why).toBe("not kept by review");
  });

  it("a 25% hole is the account stop", () => {
    const v = guardVerdict({ side: "yes", cash: 100, dayWorst: -25, kept: true, calibratedP: 0.62 });
    expect(v.risk_state).toBe("reduce");
    expect(v.fire).toBe(false);
  });

  it("three losses in a row end the day even if the hole is small", () => {
    const v = guardVerdict({ side: "yes", cash: 200, dayWorst: -5, kept: true, calibratedP: 0.62, lossesInARow: 3 });
    expect(v.risk_state).toBe("reduce");
    expect(v.fire).toBe(false);
  });

  it("fires only when review, a measured probability, and the risk state all pass", () => {
    const v = guardVerdict({ side: "no", cash: 150, dayWorst: 0, kept: true, calibratedP: 0.55 });
    expect(v.fire).toBe(true);
    expect(v.direction).toBe("short");
  });
});
