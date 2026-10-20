import { describe, expect, it } from "bun:test";
import { judgeIntel } from "./intel-gate";

const NOW = Date.parse("2026-10-20T01:00:00.000Z");
const alex = { tools: [{ provider: "cmegroup-com", capability: "fedwatch" }] };
const spark = (bias: string, asset: string, at = "2026-10-19T22:00:00.000Z") => ({
  status: "completed",
  at,
  card: { bias, asset },
});
const down = { stage: "error: not running", probability: null, at: NOW };
const docs = (sparkDoc: Record<string, unknown> | null, fish: Record<string, unknown> | null = down) => ({
  spark: sparkDoc,
  alexandria: alex,
  news: null,
  mirofish: fish,
});

describe("spark and alexandria on the send", () => {
  it("does not sit just because the spark brief is old", () => {
    const v = judgeIntel("KXBTC15M", "yes", docs({ status: "processing", at: new Date(NOW).toISOString(), card: null }), NOW);
    expect(v.ok).toBe(true);
    expect(v.why).toBe("spark_stale");
  });
  it("refuses a yes when a fresh brief on bitcoin is bearish", () => {
    const v = judgeIntel("KXBTC15M", "yes", docs(spark("bearish", "btc")), NOW);
    expect(v.ok).toBe(false);
    expect(v.why).toBe("spark_bearish_opposes_yes");
  });
  it("allows the matching side and leaves an unnamed market alone", () => {
    expect(judgeIntel("KXBTC15M", "yes", docs(spark("bullish", "btc")), NOW).ok).toBe(true);
    expect(judgeIntel("KXETH15M", "no", docs(spark("bullish", "btc")), NOW).why).toBe("spark_other_asset");
  });
  it("does not sit just because the alexandria catalog is empty", () => {
    const v = judgeIntel("KXBTC15M", "yes", { spark: spark("bullish", "btc"), alexandria: { tools: [] }, news: null, mirofish: down }, NOW);
    expect(v.ok).toBe(true);
    expect(v.why).toBe("spark_bullish_agrees");
  });
  it("refuses a yes when a fresh MiroFish read is bearish", () => {
    const fish = { stage: "done", probability: 0.2, at: NOW - 60_000 };
    const v = judgeIntel("KXBTC15M", "yes", docs(spark("unclear", "unclear"), fish), NOW);
    expect(v.ok).toBe(false);
    expect(v.why).toBe("mirofish_bearish_opposes_yes");
  });
  it("does not invent a side when MiroFish is down", () => {
    const v = judgeIntel("KXBTC15M", "yes", docs(spark("unclear", "unclear")), NOW);
    expect(v.ok).toBe(true);
    expect(v.mirofish).toBe("down");
  });
});
