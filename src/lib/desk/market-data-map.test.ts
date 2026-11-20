import { describe, expect, it } from "bun:test";
import { SERIES } from "./config";
import { RESEARCH_PRODUCT, validateBars } from "./market-data";

describe("coinbase product map", () => {
  it("names a product or an explicit null for every live series", () => {
    for (const s of SERIES) expect(s in RESEARCH_PRODUCT).toBe(true);
    expect(RESEARCH_PRODUCT.KXDOGE15M).toBe("DOGE-USD");
    expect(RESEARCH_PRODUCT.KXGOLD15M).toBeNull();
    expect(RESEARCH_PRODUCT.KXGBPUSD15M).toBeNull();
  });

  it("does not fill a missing bar", () => {
    const now = Date.parse("2026-10-20T12:30:00Z");
    const bars = [
      { t: now - 45 * 60_000, o: 1, h: 1.1, l: 0.9, c: 1, v: 2 },
      { t: now - 15 * 60_000, o: 1, h: 1.1, l: 0.9, c: 1, v: 2 },
    ];
    const chk = validateBars(bars, 15, now);
    expect(chk.bars).toHaveLength(2);
    expect(chk.gaps).toHaveLength(1);
    expect(chk.ok).toBe(false);
  });
});
