import { describe, expect, it } from "bun:test";
import { guardVerdict } from "./guard";

describe("guard", () => {
  it("a named side still does not fire without a review and a measured probability", () => {
    const v = guardVerdict({ side: "yes", cash: 150, dayWorst: 0, kept: false, calibratedP: null });
    expect(v.setup_q).toBe(2);
    expect(v.fire).toBe(false);
    expect(v.why).toBe("not kept by review");
  });

  it("a kill-switch drawdown is not safe", () => {
    const v = guardVerdict({ side: "yes", cash: 100, dayWorst: -10, kept: true, calibratedP: 0.62 });
    expect(v.risk_state).toBe("reduce");
    expect(v.regime).toBe("crisis");
    expect(v.fire).toBe(false);
  });

  it("fires only when review, a measured probability, and the risk state all pass", () => {
    const v = guardVerdict({ side: "no", cash: 150, dayWorst: 0, kept: true, calibratedP: 0.55 });
    expect(v.fire).toBe(true);
    expect(v.direction).toBe("short");
  });
});
