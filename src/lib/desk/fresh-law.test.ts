import { describe, expect, it } from "bun:test";
import { freshCall, pileRoom } from "./fresh-law";

function rise(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push(100 + i * 0.4);
  return out;
}

describe("fresh law", () => {
  it("names nothing when the averages or the strength are missing", () => {
    expect(freshCall([1, 2, 3])).toBeNull();
  });

  it("does not name a side on a straight rise with no retest", () => {
    expect(freshCall(rise(40))).toBeNull();
  });

  it("unknown cash cannot fund an order", () => {
    expect(pileRoom(0, 0)).toBe(0);
    expect(pileRoom(100, 0)).toBe(1);
    expect(pileRoom(100, -3)).toBe(1);
    expect(pileRoom(100, -4)).toBe(0);
  });
});
