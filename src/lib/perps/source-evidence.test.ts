import { describe, expect, it } from "bun:test";
import { sourcedMacroForPerp } from "./source-evidence";
import type { MacroRelease } from "./intel";
const ms = Date.parse("2026-11-08T20:00:00Z");
const e: MacroRelease = {
  name: "US CPI", assets: ["BTC", "GOLD"], actual: 0.4, consensus: 0.2, surpriseStd: 0.1,
  officialUrl: "https://www.bls.gov/news.release/cpi.nr0.htm",
  forecastUrl: "https://example.org/forecast",
  forecastAt: new Date(ms - 3600_000).toISOString(),
  publishedAt: new Date(ms - 2000).toISOString(),
  detectedAt: new Date(ms - 1000).toISOString(),
};
describe("official macro research provenance", () => {
  it("adds fresh published actual-vs-consensus to relevant perps research only", () => {
    expect(sourcedMacroForPerp("KXBTCPERP", ms, [e])).toMatchObject([{
      provider: "official", asset: "BTC", direction: "neutral", primaryVerified: true,
    }]);
    expect(sourcedMacroForPerp("KXETHPERP", ms, [e])).toHaveLength(0);
  });
  it("refuses future detection, forecast created after release and non-official issuer", () => {
    expect(sourcedMacroForPerp("KXBTCPERP", ms, [{...e, detectedAt: new Date(ms + 1000).toISOString()}])).toHaveLength(0);
    expect(sourcedMacroForPerp("KXBTCPERP", ms, [{...e, forecastAt: new Date(ms).toISOString()}])).toHaveLength(0);
    expect(sourcedMacroForPerp("KXBTCPERP", ms, [{...e, officialUrl:"https://example.com/cpi"}])).toHaveLength(0);
  });
});
