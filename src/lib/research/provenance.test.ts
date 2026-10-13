import { describe, expect, it } from "bun:test";
import { blsReleaseTime, checkProvenance, clevelandNowcastTime, isHomepage, publishedAtOf, type SeedDoc } from "./provenance";

const SIM = Date.parse("2026-10-09T21:00:00Z");
const EVENT = Date.parse("2026-10-14T12:30:00Z");
const REL_TEXT = `Transmission of material in this release is embargoed until 8:30 a.m. (ET) Friday, September 11, 2026\nCONSUMER PRICE INDEX - AUGUST 2026\nThe Consumer Price Index for All Urban Consumers (CPI-U) increased 0.4 percent ${"in August. ".repeat(30)}`;
const doc = (over: Partial<SeedDoc> = {}): SeedDoc => ({
  url: "https://www.bls.gov/news.release/cpi.nr0.htm", title: "Consumer Price Index Summary - 2026 M08 Results", text: REL_TEXT,
  publishedAt: blsReleaseTime(REL_TEXT), publishedBasis: "embargo line", fetchedAt: "2026-10-09T20:59:00Z", docType: "prior_release", ...over,
});

describe("seed provenance gate (CPI)", () => {
  it("accepts the prior CPI release, dated by its own embargo line (8:30 ET → 12:30Z)", () => {
    expect(blsReleaseTime(REL_TEXT)).toBe("2026-09-11T12:30:00.000Z");
    expect(checkProvenance(doc(), "cpi", SIM, EVENT)).toEqual({ ok: true });
  });
  it("rejects homepages (by path or by an agency-only title)", () => {
    expect(isHomepage("https://www.bls.gov/")).toBe(true);
    expect(isHomepage("https://www.bls.gov/index.htm")).toBe(true);
    expect(checkProvenance(doc({ url: "https://www.bls.gov/" }), "cpi", SIM, EVENT)).toEqual({ ok: false, reason: "homepage" });
    expect(checkProvenance(doc({ title: "U.S. Bureau of Labor Statistics :  U.S. Bureau of Labor Statistics" }), "cpi", SIM, EVENT)).toEqual({ ok: false, reason: "homepage" });
  });
  it("rejects irrelevant pages and non-CPI official pages", () => {
    expect(checkProvenance(doc({ url: "https://www.bls.gov/news.release/empsit.nr0.htm" }), "cpi", SIM, EVENT)).toEqual({ ok: false, reason: "not_catalyst_specific_url" });
    expect(checkProvenance(doc({ title: "Employment Situation", text: "Total nonfarm payroll employment rose ".repeat(20) }), "cpi", SIM, EVENT)).toEqual({ ok: false, reason: "irrelevant_content" });
    expect(checkProvenance(doc({ url: "https://example.com/news.release/cpi.nr0.htm" }), "cpi", SIM, EVENT)).toEqual({ ok: false, reason: "not_official_host" });
  });
  it("rejects undated documents and anything dated after the sim start or at/after the event", () => {
    expect(checkProvenance(doc({ publishedAt: null }), "cpi", SIM, EVENT)).toEqual({ ok: false, reason: "undated" });
    expect(checkProvenance(doc({ publishedAt: "2026-10-09T21:00:01Z", fetchedAt: "2026-10-09T21:05:00Z" }), "cpi", SIM, EVENT)).toEqual({ ok: false, reason: "published_after_sim_start" });
    // a post-release page (the actual Oct 14 CPI) can never seed a pre-event sim, even if the sim starts later
    expect(checkProvenance(doc({ publishedAt: "2026-10-14T12:30:00Z", fetchedAt: "2026-10-14T13:00:00Z" }), "cpi", Date.parse("2026-10-14T13:00:00Z"), EVENT)).toEqual({ ok: false, reason: "published_at_or_after_event" });
  });
  it("the BLS schedule page has no timestamp → undated", () => {
    const p = publishedAtOf("schedule", "https://www.bls.gov/schedule/news_release/cpi.htm", "Schedule of Releases for the Consumer Price Index ...");
    expect(p.at).toBeNull();
  });
  it("Cleveland Fed nowcast is dated from its Updated column (12:00 ET bound) and rejected before that time", () => {
    const t = "Updated each business day. every business day around 10:00 a.m. Eastern time. Month CPI Core CPI PCE Core PCE Updated October 2026 0.27 0.20 0.28 0.25 10/09 September 2026 0.53 0.20 0.43 0.25 10/09";
    expect(clevelandNowcastTime(t)).toBe("2026-10-09T16:00:00.000Z");
    const nd = doc({ url: "https://www.clevelandfed.org/indicators-and-data/inflation-nowcasting", title: "Inflation Nowcasting", text: `${t} Consumer Price Index nowcast `.repeat(4), publishedAt: clevelandNowcastTime(t), docType: "nowcast" });
    expect(checkProvenance(nd, "cpi", SIM, EVENT)).toEqual({ ok: true });
    expect(checkProvenance(nd, "cpi", Date.parse("2026-10-09T15:00:00Z"), EVENT)).toEqual({ ok: false, reason: "published_after_sim_start" });
    expect(clevelandNowcastTime("no statement October 2026 0.27 10/09")).toBeNull();
  });
});
