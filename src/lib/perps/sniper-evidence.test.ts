import { describe, expect, it } from "bun:test";
import { independentSources, qualifyPerpsSniper, type SniperInput } from "./sniper-evidence";

const t = Date.parse("2026-11-08T20:00:00Z");
const base: SniperInput = {
  ticker: "KXBTCPERP", dir: "long", decisionMs: t, venueBook: true, venueTrading: true,
  quoteAgeMs: 110, spreadBps: 2, depthMultiple: 5, score13: 11,
  structureAligned: true, validStop: true, macroBlocked: false,
  winNetUsd: 12, lossNetUsd: -5, sources: [], forecast: null,
};
const forecast: NonNullable<SniperInput["forecast"]> = {
  task: "perps_target_before_stop_filled", modelId: "walk-forward-v1",
  pHit: 0.72, conservativeLower95: 0.65, oosTrades: 350,
  brier: 0.17, benchmarkBrier: 0.22, observedUntilMs: t-86_400_000,
  evaluatedAtMs: t-3_600_000, independentHoldout: true,
};
describe("sniper evidence gate", () => {
  it("keeps high-scoring but uncalibrated setups in paper, never makes up a win probability", () => {
    const out = qualifyPerpsSniper(base);
    expect(out.stage).toBe("PAPER_ONLY");
    expect(out.evidenceP).toBeNull();
    expect(out.authorizesLiveOrder).toBe(false);
    expect(out.breakEvenP).toBeCloseTo(5 / 17);
  });
  it("only model-qualified on independent OOS fills and positive conservative after-cost EV", () => {
    const out = qualifyPerpsSniper({ ...base, forecast });
    expect(out.stage).toBe("MODEL_QUALIFIED");
    expect(out.conservativeEvUsd).toBeCloseTo(0.65*12+0.35*(-5));
    expect(out.authorizesLiveOrder).toBe(false);
  });
  it("refuses a model trained on a wrong task or a same-sample inflated score", () => {
    expect(qualifyPerpsSniper({ ...base, forecast: { ...forecast, task: "binary_settlement_yes" as any } }).stage).toBe("VETO");
    expect(qualifyPerpsSniper({ ...base, forecast: { ...forecast, independentHoldout: false } }).stage).toBe("VETO" ? "VETO" : "PAPER_ONLY");
  });
  it("refuses stale books, insufficient depth, upside from missing costs, and macro lockout", () => {
    for (const change of [{ quoteAgeMs: 10_000 },{depthMultiple: 0},{winNetUsd: null},{macroBlocked: true}]) {
      expect(qualifyPerpsSniper({ ...base,...change,forecast }).stage).toBe("VETO");
    }
  });
  it("does not count a Spark rewrite and Firecrawl scrape of the same primary release twice", () => {
    const one = { provider: "firecrawl" as const, primaryUrl: "https://www.bls.gov/news.release/empsit.nr0.htm", asset: "BTC", publishedMs: t-1000, receivedMs: t-500, direction: "neutral" as const, primaryVerified: true };
    const a = { ...base, sources: [one, {...one, provider:"spark" as const,receivedMs:t-200}] };
    expect(independentSources(a)).toHaveLength(1);
    expect(qualifyPerpsSniper(a).independentPrimarySources).toBe(1);
  });
  it("rejects look-ahead, unsigned news and a verified opposing macro release", () => {
    const src = {provider:"official" as const,primaryUrl:"https://www.bls.gov/news.release/cpi.nr0.htm",asset:"BTC",publishedMs:t-500,receivedMs:t-100,direction:"opposes" as const,primaryVerified:true};
    expect(qualifyPerpsSniper({ ...base,forecast,sources:[src]}).stage).toBe("VETO");
    expect(independentSources({ ...base,sources:[{...src,publishedMs:t+1}]})).toHaveLength(0);
    expect(independentSources({ ...base,sources:[{...src,primaryVerified:false}]})).toHaveLength(0);
  });
});
