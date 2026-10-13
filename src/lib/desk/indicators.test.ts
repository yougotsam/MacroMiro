import { describe, expect, it } from "bun:test";
import { TradeTape, availabilitySummary, candlePatterns, fibLevels, indicatorReport, liquiditySweep, marketStructure, volumeProfile } from "./indicators";
import { atr, bollinger, confirmedSwings, cvd, emaSeries, fvg, macd, orderBlockCandidate, rsiSeries, rvol, stochRsi, vwap, type Candle } from "./sniper";
import type { PublicTrade } from "./market-data";

/** piecewise-linear path through turning points, 4 bars per leg; tiny bodies around the close so turning points are strict pivots */
function path(points: number[], v = 10): Candle[] {
  const closes: number[] = [points[0]];
  for (let i = 1; i < points.length; i += 1) for (let k = 1; k <= 4; k += 1) closes.push(points[i - 1] + ((points[i] - points[i - 1]) * k) / 4);
  return closes.map((c, i) => {
    const o = i ? c + (closes[i - 1] - c) * 0.1 : c;
    return { t: i * 60_000, o, c, h: Math.max(o, c) + 0.1, l: Math.min(o, c) - 0.1, v };
  });
}
const bar = (t: number, o: number, h: number, l: number, c: number, v = 1): Candle => ({ t, o, h, l, c, v });

describe("structure: BOS / MSS / sweep / FVG / order block / Fibonacci", () => {
  it("downtrend then a close above the last swing high = MSS long (not BOS)", () => {
    const b = path([100, 96, 98, 94, 96, 92, 94.5, 91, 97]);
    const s = marketStructure(b)!;
    expect(s.trend).toBe("down");
    expect(s.mss).toBe("long");
    expect(s.bos).toBeNull();
  });
  it("uptrend continuation above the last swing high = BOS long", () => {
    const b = path([90, 94, 92, 96, 94, 98, 96, 101]);
    const s = marketStructure(b)!;
    expect(s.trend).toBe("up");
    expect(s.bos).toBe("long");
    expect(s.mss).toBeNull();
  });
  it("too few bars → null (unavailable, not guessed)", () => {
    expect(marketStructure(path([100, 101]))).toBeNull();
  });
  it("a wick through the last swing low that closes back above = bullish sweep", () => {
    const b = path([100, 96, 99, 97.5, 100, 98.5, 99]);
    const swingLow = confirmedSwings(b).lows.at(-1)!.price;
    const a = atr(b)!;
    b.push(bar(b.length * 60_000, 99, 99.2, swingLow - 0.5 * a, 98.9));
    expect(liquiditySweep(b)).toBe("long");
  });
  it("FVG: gap between bar 1 high and bar 3 low", () => {
    const b = [bar(0, 100, 101, 99, 100.5), bar(1, 100.5, 104, 100.4, 103.8), bar(2, 103.8, 105, 102, 104.5)];
    expect(fvg(b, 2)).toEqual({ direction: "long", low: 101, high: 102 });
  });
  it("order block: last down candle before ≥1.2 ATR displacement that closes above it", () => {
    const b = [bar(0, 100, 100.5, 99.5, 100), bar(1, 100, 100.5, 99.5, 100.1), bar(2, 100.1, 100.2, 99.4, 99.6), bar(3, 99.6, 101.5, 99.6, 101.4), bar(4, 101.4, 102.8, 101.3, 102.6), bar(5, 102.6, 102.9, 102.2, 102.7)];
    expect(orderBlockCandidate(b, "long", 1)).toEqual({ low: 99.4, high: 100.2, index: 2 });
  });
  it("Fibonacci levels from swing low/high", () => {
    const f = fibLevels(100, 200)!;
    expect(f["0.618"]).toBeCloseTo(138.2, 6);
    expect(f["0.5"]).toBe(150);
    expect(fibLevels(200, 100)).toBeNull();
  });
});

describe("trend / momentum / volatility", () => {
  const up = Array.from({ length: 250 }, (_, i) => 100 + i * 0.5);
  it("EMA 7/14/50/200 on a constant series equals the constant; too short → empty", () => {
    for (const n of [7, 14, 50, 200]) expect(emaSeries(new Array(250).fill(5), n).at(-1)).toBeCloseTo(5, 9);
    expect(emaSeries([1, 2, 3], 7)).toEqual([]);
  });
  it("RSI 100 on a pure uptrend; Stoch RSI / MACD defined and MACD positive", () => {
    expect(rsiSeries(up).at(-1)).toBe(100);
    const wavy = up.map((x, i) => x + Math.sin(i / 3) * 2);
    expect(stochRsi(wavy)).not.toBeNull();
    expect(macd(up)!.line).toBeGreaterThan(0);
  });
  it("ATR of constant-range bars = the range; Bollinger width 0 on a flat series", () => {
    const b = Array.from({ length: 30 }, (_, i) => bar(i, 100, 101, 99, 100));
    expect(atr(b)).toBeCloseTo(2, 9);
    expect(bollinger(new Array(20).fill(7))!.width).toBe(0);
  });
});

describe("candlestick patterns", () => {
  it("engulfing, hammer, shooting star, doji, inside bar", () => {
    expect(candlePatterns([bar(0, 101, 101.2, 99.8, 100), bar(1, 99.9, 101.6, 99.7, 101.5)])).toContain("bullish_engulfing");
    expect(candlePatterns([bar(0, 100, 101.2, 99.8, 101), bar(1, 101.1, 101.2, 99.4, 99.5)])).toContain("bearish_engulfing");
    expect(candlePatterns([bar(0, 100, 101, 99, 100.5), bar(1, 100, 100.25, 98, 100.2)])).toContain("hammer");
    expect(candlePatterns([bar(0, 100, 101, 99, 100.5), bar(1, 100.2, 102.2, 99.95, 100)])).toContain("shooting_star");
    const p = candlePatterns([bar(0, 100, 103, 97, 101), bar(1, 100, 101, 99, 100.05)]);
    expect(p).toContain("doji");
    expect(p).toContain("inside_bar");
  });
});

describe("volume: VWAP / RVOL / CVD / volume profile — real volume only", () => {
  it("VWAP and RVOL need real volume; missing volume → null", () => {
    expect(vwap([bar(0, 1, 2, 1, 1.5, 10), bar(1, 1.5, 3, 1.5, 3, 30)])).toBeCloseTo((1.5 * 10 + 2.5 * 30) / 40, 9);
    const b = Array.from({ length: 21 }, (_, i) => bar(i, 1, 1, 1, 1, i === 20 ? 30 : 10));
    expect(rvol(b)).toBe(3);
    expect(rvol(b.map(({ v: _v, ...x }) => x))).toBeNull();
  });
  it("TradeTape: Coinbase side is the maker side; gaps in trade ids leave minutes unknown", () => {
    const t = (id: number, sec: number, side: "buy" | "sell", size: number): PublicTrade => ({ trade_id: id, side, size: String(size), price: "1", time: new Date(sec * 1000).toISOString() });
    const tape = new TradeTape();
    // minute 1 (60–119 s) fully covered: maker sell (aggressive buy) 2, maker buy 0.5 → +1.5
    tape.add([t(1, 59, "sell", 9), t(2, 61, "sell", 2), t(3, 100, "buy", 0.5), t(4, 121, "sell", 1)]);
    expect(tape.deltaByMinute().get(60_000)).toBeCloseTo(1.5, 9);
    // a later batch with a gap (ids 10..) does not create deltas across the hole
    tape.add([t(10, 400, "sell", 5), t(11, 470, "sell", 5)]);
    const d = tape.deltaByMinute();
    expect(d.has(240_000)).toBe(false);
    expect(cvd([{ ...bar(0, 1, 1, 1, 1), delta: 2 }, { ...bar(1, 1, 1, 1, 1), delta: -0.5 }])).toBe(1.5);
  });
  it("volume profile: POC sits where the volume is", () => {
    const b = [bar(0, 100, 101, 100, 101, 1), bar(1, 101, 110, 101, 109, 1), bar(2, 109, 110, 109, 109.5, 50)];
    const vp = volumeProfile(b)!;
    expect(vp.poc).toBeGreaterThan(108.5); // the 50-lot bar spans 109–110; bin centres are 0.42 wide
    expect(vp.poc).toBeLessThan(110);
    expect(vp.val).toBeLessThanOrEqual(vp.poc);
    expect(vp.vah).toBeGreaterThanOrEqual(vp.poc);
    expect(volumeProfile([bar(0, 1, 2, 1, 2)].map(({ v: _v, ...x }) => x))).toBeNull();
  });
});

describe("availability report: unavailable inputs are reported, never faked", () => {
  const bars = path([100, 96, 98, 94, 96, 92, 94.5, 93, 97, 95, 99, 97, 101, 99, 103, 101, 105, 103, 107, 104, 108, 106, 110, 108, 112, 109, 113, 111, 115, 112, 116, 114, 118, 116, 120, 117, 121, 119, 123, 120, 124, 122, 126, 124, 128, 125, 129, 127, 131, 129, 133, 130]);
  it("crypto with volume but no signed trades: CVD unavailable, VWAP/RVOL/profile available", () => {
    const s = availabilitySummary(indicatorReport(bars, { volumeSource: "coinbase:BTC-USD", tradeSide: false }));
    expect(s.unavailable.cvd).toContain("no signed");
    for (const k of ["vwap", "rvol", "volume_profile", "ema7", "ema14", "ema50", "ema200", "rsi", "macd", "atr", "bollinger", "stoch_rsi", "bos_mss", "liquidity_sweep", "fvg", "order_block", "fibonacci", "candle_patterns"]) expect(s.available).toContain(k);
  });
  it("gold (no traded-volume source): VWAP, RVOL, volume profile and CVD are unavailable", () => {
    const noVol = bars.map(({ v: _v, ...x }) => x);
    const s = availabilitySummary(indicatorReport(noVol, { volumeSource: null, tradeSide: false }));
    for (const k of ["vwap", "rvol", "volume_profile", "cvd"]) expect(s.unavailable[k]).toBeDefined();
    expect(s.unavailable.vwap).toContain("no traded-volume source");
  });
  it("short history: EMA200 reports how many bars it needs", () => {
    const s = availabilitySummary(indicatorReport(bars.slice(0, 40), { volumeSource: "x", tradeSide: true }));
    expect(s.unavailable.ema200).toBe("EMA200 needs 200 bars, have 40");
  });
});
