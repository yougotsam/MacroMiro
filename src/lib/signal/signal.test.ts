/** The pre-trade pipeline: indicators, structure, model, the #124 protocol, the checklist, the brake, and news. */
import { describe, expect, it } from "bun:test";
import { emaSeries, rsiSeries, atrSeries, type Bar } from "./ta";
import { liquiditySweepAt, openFvgAt } from "./smc";
import { fitLogistic, predict } from "./model";
import { PROTOCOL, clusteredMean, kalshiFeePer, predTrade, samplesFor, walkForward } from "./backtest";
import { cacheOf, vectorAt, WARMUP, FEATURES } from "./features";
import { brakeCount, lossesInARow } from "./brake";
import { OWNER_BLANKS } from "./config";
import { readNews } from "./news";
import { sessionOf } from "./session";
import { preTrade } from "./checklist";

const START = Date.parse("2026-05-01T00:00:00Z");
function walk(n: number, seed = 7): Bar[] {
  let x = seed, c = 100;
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647) - 0.5;
  return Array.from({ length: n }, (_, i) => {
    const o = c;
    c = Math.max(1, c * (1 + rnd() * 0.01));
    return { t: START + i * 900_000, o, h: Math.max(o, c) * 1.001, l: Math.min(o, c) * 0.999, c, v: 1 };
  });
}

describe("indicators", () => {
  it("EMA, RSI and ATR are null until warm, then sane", () => {
    const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const e = emaSeries(v, 3);
    expect(e[0]).toBeNull();
    expect(e[9]!).toBeGreaterThan(8);
    const r = rsiSeries(v.concat(v.map((x) => 10 + x)), 5);
    expect(r[r.length - 1]!).toBeGreaterThan(90);
    const a = atrSeries(walk(40), 14);
    expect(a[5]).toBeNull();
    expect(a[39]!).toBeGreaterThan(0);
  });
  it("a sweep below the lows that closes back is a long sweep; a three-bar gap up is a bullish FVG", () => {
    const b = walk(30).map((x) => ({ ...x, o: 100, c: 100, h: 101, l: 99 }));
    b[29] = { ...b[29], l: 97, c: 100.5, h: 101 };
    expect(liquiditySweepAt(b, 29)).toBe(1);
    const g = walk(10).map((x) => ({ ...x, o: 100, c: 100, h: 101, l: 99 }));
    g[8] = { ...g[8], o: 101, c: 104, h: 104, l: 101 };
    g[9] = { ...g[9], o: 104, c: 104.5, h: 105, l: 102 };
    expect(openFvgAt(g, 9)).toBe(1);
  });
  it("killzones are on the New York clock", () => {
    expect(sessionOf(Date.parse("2026-10-26T12:30:00Z"))).toBe("ny_am"); // 8:30 NY
    expect(sessionOf(Date.parse("2026-10-26T07:00:00Z"))).toBe("london"); // 3:00 NY
  });
});

describe("features never look ahead", () => {
  it("the vector at bar i does not change when later bars are added or altered", () => {
    const b = walk(WARMUP + 50);
    const i = WARMUP + 10;
    const a = vectorAt(cacheOf(b.slice(0, i + 1)), i)!;
    const mutated = b.map((x, k) => (k > i ? { ...x, c: x.c * 3, h: x.h * 3 } : x));
    const z = vectorAt(cacheOf(mutated), i)!;
    for (const f of FEATURES) expect(z[f]).toBeCloseTo(a[f], 9);
  });
});

describe("model and protocol", () => {
  it("logistic fit recovers a known sign", () => {
    const X: number[][] = [], y: number[] = [];
    for (let i = 0; i < 400; i++) {
      const x = (i % 20) / 10 - 1;
      X.push([x]);
      y.push(x + Math.sin(i) * 0.6 > 0 ? 1 : 0);
    }
    const m = fitLogistic(X, y, 1);
    expect(m.weights[0]).toBeGreaterThan(0);
    expect(predict(m, [1])).toBeGreaterThan(0.5);
  });
  it("fees are charged on every trade and a 51¢ fill needs a real edge", () => {
    expect(kalshiFeePer(0.51)).toBeGreaterThan(0);
    const win = predTrade(0.6, 1, 0.03)!;
    const loss = predTrade(0.6, 0, 0.03)!;
    expect(win.pnl).toBeCloseTo(1 - PROTOCOL.predPrice - kalshiFeePer(PROTOCOL.predPrice), 9);
    expect(loss.pnl).toBeCloseTo(-PROTOCOL.predPrice - kalshiFeePer(PROTOCOL.predPrice), 9);
    expect(predTrade(0.51, 1, 0.03)).toBeNull();
  });
  it("walk-forward only trades after the first 21 training days", () => {
    const s = samplesFor("BTC", walk(WARMUP + 3500, 11));
    const wf = walkForward(s);
    expect(wf.folds).toBeGreaterThan(0);
    for (const t of wf.prediction) expect(t.t).toBeGreaterThanOrEqual(s[0].t + PROTOCOL.minTrainDays * 86_400_000);
    const m = clusteredMean([{ t: 1, pnl: 1 }, { t: 1, pnl: -1 }]);
    expect(m.mean).toBe(0);
  });
});

describe("checklist, brake, news, owner blanks", () => {
  it("not enough bars is a hard stop, never a trade", () => {
    const c = preTrade({ asset: "BTC", product: "prediction", bars: walk(100), now: START + 100 * 900_000, releases: [], docs: { spark: null, alexandria: null, mirofish: null }, file: null });
    expect(c.fire).toBe(false);
    expect(c.why).toBe("data not ready");
  });
  it("no model file means no side", () => {
    const b = walk(WARMUP + 20);
    const c = preTrade({ asset: "BTC", product: "prediction", bars: b, now: b[b.length - 1].t + 16 * 60_000, releases: [], docs: { spark: null, alexandria: null, mirofish: null }, file: null });
    expect(c.fire).toBe(false);
  });
  it("two losses in a row halve the size; a win resets", () => {
    expect(lossesInARow([1, -1, -1])).toBe(2);
    expect(lossesInARow([-1, -1, 1])).toBe(0);
    expect(brakeCount(4, 2)).toBe(2);
    expect(brakeCount(4, 1)).toBe(4);
  });
  it("MiroFish is null when it is down or stale — never invented", () => {
    const now = Date.now();
    expect(readNews("BTC", { spark: null, alexandria: null, mirofish: { stage: "unavailable" } }, now).mirofishP).toBeNull();
    expect(readNews("BTC", { spark: null, alexandria: null, mirofish: { stage: "done", at: now - 86_400_000, probability: 0.7 } }, now).mirofishP).toBeNull();
    expect(readNews("BTC", { spark: null, alexandria: null, mirofish: null }, now).mirofishP).toBeNull();
    expect(readNews("BTC", { spark: null, alexandria: null, mirofish: { stage: "done", at: now - 60_000, probability: 0.7 } }, now).mirofishP).toBe(0.7);
  });
  it("Sameer's own numbers stay blank", () => {
    for (const v of Object.values(OWNER_BLANKS)) expect(v).toBeNull();
  });
});
