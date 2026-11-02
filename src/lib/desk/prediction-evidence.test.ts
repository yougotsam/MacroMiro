import { describe, expect, it } from "bun:test";
import { gradePredictionBatch, gradePredictionFill, type PredictionFillEvidence } from "./prediction-evidence";

const base: PredictionFillEvidence = {
  ticker: "KXBTC15M-26NOV02-T0700",
  modelVersion: "calibrated-test-hash",
  datasetSplitId: "walk-forward-2026-11-heldout",
  datasetHash: "sha256-immutable-fixture",
  quoteMs: 1_000,
  decisionMs: 1_500,
  fillMs: 1_800,
  closeMs: 60_000,
  settlementMs: 120_000,
  side: "yes",
  yesProbability: 0.8,
  filledPriceUsd: 0.62,
  quantity: 10,
  totalFeesUsd: 0.25,
  result: "yes",
  settlementSource: "https://kalshi.com/markets/test",
  oos: true,
};

describe("prediction evidence (venue settlement, not next-candle direction)", () => {
  it("uses actual fill price, fees and final outcome to compute net P&L", () => {
    const out = gradePredictionFill(base);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.data.netUsd).toBeCloseTo(3.55, 6);
    expect(out.data.modelBrier).toBeCloseTo(0.04, 6);
    expect(out.data.entryBrier).toBeCloseTo(0.1444, 6);
  });
  it("rejects missing settlement, stale quote and missing holdout provenance", () => {
    expect(gradePredictionFill({ ...base, result: "undetermined" }).ok).toBe(false);
    expect(gradePredictionFill({ ...base, quoteMs: 0, decisionMs: 5_000 }).ok).toBe(false);
    expect(gradePredictionFill({ ...base, datasetHash: "" }).ok).toBe(false);
    expect(gradePredictionFill({ ...base, oos: undefined as unknown as boolean }).ok).toBe(false);
  });
  it("grades only finalized, timestamped, comparable out-of-sample fills", () => {
    const r = gradePredictionBatch([base, { ...base, ticker: "SECOND", side: "no", result: "yes" }, { ...base, result: "void" }, { ...base, ticker: "INSAMPLE", oos: false }]);
    expect(r.accepted).toBe(3);
    expect(r.rejected).toBe(1);
    expect(r.oosTrades).toBe(2);
    expect(r.netOosUsd).toBeCloseTo(-2.9, 6); // 3.55 + (-6.45)
    expect(r.status).toBe("RESEARCH_ONLY_NOT_AN_APPROVAL");
  });
});
