import { describe, expect, it } from "bun:test";
import { judgeIntel } from "./intel-gate";

const NOW = Date.parse("2026-10-20T01:00:00.000Z");
const alex = { tools: [{ provider: "cmegroup-com", capability: "fedwatch" }] };
const spark = (bias: string, asset: string, at = "2026-10-19T22:00:00.000Z") => ({
  status: "completed",
  at,
  card: { bias, asset },
});

describe("spark and alexandria on the send", () => {
  it("refuses when the spark brief is old or unfinished", () => {
    expect(judgeIntel("KXBTC15M", "yes", { spark: { status: "processing", at: new Date(NOW).toISOString(), card: null }, alexandria: alex, news: null }, NOW).why).toBe("spark_not_ready");
  });
  it("refuses a yes when a fresh brief on bitcoin is bearish", () => {
    const v = judgeIntel("KXBTC15M", "yes", { spark: spark("bearish", "btc"), alexandria: alex, news: null }, NOW);
    expect(v.ok).toBe(false);
    expect(v.why).toBe("spark_bearish_opposes_yes");
  });
  it("allows the matching side and leaves an unnamed market alone", () => {
    expect(judgeIntel("KXBTC15M", "yes", { spark: spark("bullish", "btc"), alexandria: alex, news: null }, NOW).ok).toBe(true);
    expect(judgeIntel("KXETH15M", "no", { spark: spark("bullish", "btc"), alexandria: alex, news: null }, NOW).why).toBe("spark_other_asset");
  });
  it("refuses when alexandria has not been loaded", () => {
    expect(judgeIntel("KXBTC15M", "yes", { spark: spark("bullish", "btc"), alexandria: { tools: [] }, news: null }, NOW).why).toBe("alexandria_not_loaded");
  });
});
