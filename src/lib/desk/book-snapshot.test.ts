import { describe, expect, it } from "bun:test";
import { bestBid, impliedAsk } from "./book-snapshot";

describe("top of book", () => {
  it("takes the last level as the best bid and implies the ask from the other side", () => {
    const yes = bestBid([["0.1000", "5"], ["0.8500", "10"]]);
    const no = bestBid([["0.1400", "254.94"]]);
    expect(yes).toEqual({ price: 0.85, size: 10 });
    expect(impliedAsk(no)).toEqual({ price: 0.86, size: 254.94 });
    expect(impliedAsk(null)).toBeNull();
    expect(bestBid([])).toBeNull();
  });
});
