import { describe, expect, it } from "bun:test";
import { credible, summarizeEvaluation, type Analysis } from "./evaluate-summary";

const pnl = (mean: number, se: number) => ({ trades: 40, windows: 35, total: mean * 40, meanPerTrade: mean, clusteredSe: se, ci95: [mean - 1.96 * se, mean + 1.96 * se] as [number, number] });
const setup = (resid: number, rse: number, p: ReturnType<typeof pnl>, contracts = 40, windows = 35) => ({ contracts, windows, residualVsSettlementModel: { mean: resid, clusteredSe: rse }, takerAfterCost: p, verdict: "x" });

describe("evaluation summary", () => {
  it("credible only with enough sample AND both residual and after-cost P/L beyond the Bonferroni bar", () => {
    expect(credible(setup(0.1, 0.02, pnl(0.2, 0.05)))).toBe(true);
    expect(credible(setup(0.1, 0.02, pnl(0.2, 0.1)))).toBe(false); // P/L only 2 SE
    expect(credible(setup(0.1, 0.02, pnl(0.2, 0.05), 29))).toBe(false);
    expect(credible(setup(0.1, 0.02, pnl(0.2, 0.05), 40, 20))).toBe(false);
  });
  it("labels PRELIMINARY below 200 windows, gives the ETA, and never promotes", () => {
    const a: Analysis = { collector: { independentClosingWindows: { completed: 37, remaining: 163, etaAt: "2026-10-11T14:00:00Z" } }, liveShadow: { byModel: { m: { observations: 10, calibration: {}, pnl: {}, namedSetups: { FVG_OPEN: setup(0.1, 0.02, pnl(0.2, 0.05)) } } } } };
    const s = summarizeEvaluation(a);
    expect(s.label).toMatch(/PRELIMINARY/);
    expect(s.windows.etaAt).toBe("2026-10-11T14:00:00Z");
    expect(s.promotion).toMatch(/promotes nothing/);
    const b = summarizeEvaluation({ ...a, collector: { independentClosingWindows: { completed: 200, remaining: 0, etaAt: "x" } } });
    expect(b.label).not.toMatch(/PRELIMINARY/);
    expect(b.promotion).toMatch(/promotes nothing/);
  });
  it("the evaluator imports nothing that can trade", async () => {
    const { readFileSync } = await import("node:fs");
    for (const f of ["./evaluate-summary.ts", "../../../scripts/desk-evaluate.ts"]) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(src).not.toMatch(/from ".*(oms|engine|risk|kalshi-auth|envelope|live\/)/);
      expect(src).not.toMatch(/CALIBRATED_MODEL_APPROVED\s*=|placeEventOrder/);
    }
  });
});
