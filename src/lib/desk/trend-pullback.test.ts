import { describe, expect, it } from "bun:test";
import { evaluateSniper, type Candle } from "./sniper";

const H = 3_600_000, M15 = 900_000;
const hourly: Candle[] = Array.from({ length: 220 }, (_, i) => ({ t: i * H, o: 100 + i * 0.1, h: 100.5 + i * 0.1, l: 99.5 + i * 0.1, c: 100 + i * 0.1, v: 10 }));
// steady uptrend whose bars never come back to EMA14: aligned EMAs but no pullback
const straight: Candle[] = Array.from({ length: 80 }, (_, i) => { const c = 100 + i; return { t: i * M15, o: c - 0.4, h: c + 0.2, l: c - 0.5, c, v: 10 }; });

describe("TREND_PULLBACK requires a real pullback", () => {
  it("aligned EMAs without a retrace to EMA14 is not TREND_PULLBACK", () => {
    expect(evaluateSniper(straight, hourly, "long", true).setup).not.toBe("TREND_PULLBACK");
  });
  it("uptrend that dips to EMA14 and closes back above it is TREND_PULLBACK", () => {
    const b = straight.map((x) => ({ ...x }));
    // dip: bar -3 trades down ~6 points (below EMA14, which lags ~6.5 under price), later bars recover
    b[b.length - 3] = { ...b[b.length - 3], l: b[b.length - 3].c - 9 };
    expect(evaluateSniper(b, hourly, "long", true).setup).toBe("TREND_PULLBACK");
  });
});
