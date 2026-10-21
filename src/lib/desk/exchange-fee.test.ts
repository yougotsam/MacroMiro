import { describe, expect, it } from "bun:test";
import { exchangeFee } from "./exchange-fee";

describe("exchange fee", () => {
  it("uses Kalshi's numbers, including a real zero", () => {
    expect(exchangeFee({ taker_fees_dollars: "0", maker_fees_dollars: "0" })).toEqual({ fee: 0, feeSource: "exchange" });
    expect(exchangeFee({ taker_fees_dollars: "0.1188", maker_fees_dollars: "0" }).fee).toBeCloseTo(0.1188, 6);
  });
  it("does not invent a fee when the exchange did not say", () => {
    expect(exchangeFee(null)).toEqual({ fee: null, feeSource: "unknown" });
    expect(exchangeFee({})).toEqual({ fee: null, feeSource: "unknown" });
    expect(exchangeFee({ taker_fees_dollars: "nope" }).feeSource).toBe("unknown");
  });
});
