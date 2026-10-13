import { describe, expect, it } from "bun:test";
import { evaluateEvent, parseCpiMoM, parseNowcastMoM, surpriseClass, type Point } from "./post-event";

const EV = Date.parse("2026-10-14T12:30:00Z");
/** 1-min series, random-walk-ish noise before the event, then a fixed move after it */
function series(start: number, moveAfter: number): Point[] {
  const xs: Point[] = [];
  let v = start;
  for (let t = EV - 5 * 3600_000; t <= EV + 5 * 3600_000; t += 60_000) {
    const i = (t - EV) / 60_000;
    v *= 1 + 0.0005 * Math.sin(i * 1.7);
    xs.push({ ms: t, value: t > EV ? v * (1 + moveAfter) : v });
  }
  return xs;
}
const runs = ["baseline", "bullish", "bearish", "unexpected"].map((s, i) => ({ id: `r${i}`, scenario: s, lean: s === "bullish" ? "bullish" : s === "bearish" ? "bearish" : s === "unexpected" ? "bullish" : "mixed", assets: ["BTC", "GOLD"] }));

describe("post-event comparison (CPI)", () => {
  it("parses the official print and the archived nowcast", () => {
    expect(parseCpiMoM("The Consumer Price Index for All Urban Consumers (CPI-U) increased 0.4 percent on a seasonally adjusted basis in September after", "September")).toBe(0.4);
    expect(parseCpiMoM("(CPI-U) was unchanged on a seasonally adjusted basis in September", "September")).toBe(0);
    expect(parseCpiMoM("(CPI-U) declined 0.1 percent on a seasonally adjusted basis in September", "September")).toBe(-0.1);
    expect(parseCpiMoM("(CPI-U) increased 0.4 percent on a seasonally adjusted basis in August", "September")).toBeNull();
    expect(parseNowcastMoM("Inflation, month-over-month percent change Month CPI Core CPI PCE Core PCE Updated October 2026 0.27 0.20 September 2026 0.53 0.20 0.43", "September 2026")).toBe(0.53);
  });
  it("classifies the surprise", () => {
    expect(surpriseClass(0.05)).toBe("baseline");
    expect(surpriseClass(0.2)).toBe("bearish");
    expect(surpriseClass(-0.2)).toBe("bullish");
  });
  it("hot print + BTC down: bearish scenario's lean is scored, baseline (news) also right", () => {
    const r = evaluateEvent({ eventMs: EV, surprisePp: 0.3, runs, prices: { BTC: series(80000, -0.02) } });
    const row = r.rows.find((x) => x.horizonMin === 60)!;
    expect(row.realized).toBe("down");
    expect(row.realizedClass).toBe("bearish");
    expect(row.mirofishRun).toBe("r2");
    expect(row.mirofishHit).toBe(true);
    expect(row.baselineHit).toBe(true);
  });
  it("hot print + BTC up beyond 1σ is an 'unexpected reaction' and uses that scenario", () => {
    const r = evaluateEvent({ eventMs: EV, surprisePp: 0.3, runs, prices: { BTC: series(80000, 0.02) } });
    const row = r.rows.find((x) => x.horizonMin === 15)!;
    expect(row.realizedClass).toBe("unexpected");
    expect(row.mirofishRun).toBe("r3");
    expect(row.baselineHit).toBe(false);
  });
  it("missing prices → no_data rows, never filled in", () => {
    const r = evaluateEvent({ eventMs: EV, surprisePp: 0, runs, prices: { GOLD: [] } });
    expect(r.rows.every((x) => x.status === "no_data" && x.ret == null)).toBe(true);
    expect(r.mirofish.n).toBe(0);
  });
  it("the post-event script refuses to run before release + 4 h and imports nothing that trades", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../../../scripts/research-post-event.ts", import.meta.url), "utf8");
    expect(src).toMatch(/too_early/);
    expect(src).not.toMatch(/from ".*(desk\/oms|desk\/engine|desk\/risk|kalshi-auth|envelope)/);
  });
});
