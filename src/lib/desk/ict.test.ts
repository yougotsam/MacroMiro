import { describe, expect, it } from "bun:test";
import { fairGap, inKillzone, sweepGap } from "./ict";

describe("ict sequence", () => {
  it("a bull gap needs the older high under the latest low", () => {
    expect(fairGap([{ h: 10, l: 9, c: 9.5 }, { h: 12, l: 11, c: 11.5 }, { h: 14, l: 13, c: 13.5 }])).toBe("yes");
    expect(fairGap([{ h: 10, l: 9, c: 9.5 }, { h: 10, l: 9, c: 9.5 }, { h: 10, l: 9, c: 9.5 }])).toBeNull();
  });

  it("no sweep, no side", () => {
    const flat = Array.from({ length: 10 }, () => ({ h: 10, l: 9, c: 9.5 }));
    expect(sweepGap(flat)).toBeNull();
  });

  it("names the New York morning, not the middle of the night", () => {
    const morning = Date.parse("2026-10-26T14:00:00Z");
    const night = Date.parse("2026-10-26T06:00:00Z");
    expect(inKillzone(morning)).toBe(true);
    expect(inKillzone(night)).toBe(false);
  });
});
