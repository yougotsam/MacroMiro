import { describe, expect, it } from "bun:test";
import { resolveRiskLimits, RISK_LIMITS, MODEL_VERSION, MAX_ORDER_COST_USD } from "../desk/config";
import { aggressionReleaseAllowed, FAST_LANE_MIN, FAST_LANE_Z, judgeSetup, promotionDocument } from "./promotion";
import { toScoreRow } from "./retro";
import type { DecisionRow } from "./scorecard";

function sharp(n: number): DecisionRow {
  const y: 0 | 1 = n % 2 === 0 ? 1 : 0;
  return {
    at: n, expiryMs: n * 60_000, series: "KXBTC15M", setup: "settlement-model",
    modelPYes: y ? 0.8 : 0.2, yesPrice: 0.5, edge: 0.02, mode: "none", featureHash: "t",
    settledYes: y, pnlAfterFees: 0.05, fresh: true, tteSec: 200, filled: false,
  };
}

describe("fast lane", () => {
  it("100 sharp rows clear 80%, 99 do not", () => {
    const opts = { minDecisions: FAST_LANE_MIN, z: FAST_LANE_Z, windowSize: 25, embargoMs: 0 };
    expect(judgeSetup(Array.from({ length: 100 }, (_, i) => sharp(i)), opts).state).toBe("ELIGIBLE");
    expect(judgeSetup(Array.from({ length: 99 }, (_, i) => sharp(i)), opts).why).toContain("99");
  });

  it("a model worse than the price stays in research and blocks the cap raise", () => {
    const rows = Array.from({ length: 120 }, (_, i) => sharp(i)).map((r) => ({ ...r, modelPYes: r.settledYes === 1 ? 0.2 : 0.8 }));
    const doc = promotionDocument({ "settlement-model": rows }, 1, MODEL_VERSION, { minDecisions: FAST_LANE_MIN, z: FAST_LANE_Z, windowSize: 25, embargoMs: 0 });
    expect(doc.setups["settlement-model"].state).toBe("RESEARCH");
    expect(aggressionReleaseAllowed(doc).ok).toBe(false);
  });

  it("an unknown account value refuses percent sizing", () => {
    const refused = resolveRiskLimits({ ...RISK_LIMITS, mode: "pct_of_account" }, null);
    expect(refused.ok).toBe(false);
  });

  it("reads a logged decision back into a score row", () => {
    const row = toScoreRow({
      ts: "2026-10-17T11:13:50.814Z", ticker: "KXBTC15M-26OCT170715-15", series: "KXBTC15M", tte_s: 69, p: 0.75,
      quotes: { yes_bid: 0.87, yes_ask: 0.88, no_bid: 0.12, no_ask: 0.13 }, fee_multiplier: 1,
      index_age_ms: 100, book_age_ms: 100,
    }, "no");
    expect(row?.setup).toBe("settlement-model");
    expect(row?.settledYes).toBe(0);
    expect(row?.pnlAfterFees).toBeLessThan(0);
  });
});
