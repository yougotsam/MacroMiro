import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { macroGate, macroGateOfficial } from "./macro-calendar";
import { etWallToUtc, fetchOfficialCalendar, parseFomcPage, parseIcs, verifyCalendar, type OfficialCalendar } from "./official-calendar";

const BLS = ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART;TZID=US-Eastern:20261014T083000", "SUMMARY:Consumer Price Index", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART;TZID=US-Eastern:20261204T083000", "SUMMARY:Employment Situation", "END:VEVENT",
  "BEGIN:VEVENT", "DTSTART:20261020T083000", "SUMMARY:Floating time (refused)", "END:VEVENT", "END:VCALENDAR"].join("\r\n");
const BEA = "BEGIN:VEVENT\r\nSUMMARY:Gross Domestic Product\\, 3rd Quarter 2026 (Advance Estima\r\n te)\r\nDTSTART;VALUE=DATE-TIME:20261029T123000Z\r\nEND:VEVENT\r\n";
const FED = "<h4>2026 FOMC Meetings</h4><p>September 15-16*</p> Minutes (Released October 07, 2026) <p>October 27-28</p><p>December 8-9*</p> <p>August 22 (notation vote)</p> * Meeting associated <h4>2027 FOMC Meetings</h4> January 26-27 Note: A two-day meeting is scheduled for January 25-26, 2028. Last Update: October 07, 2026";
const NOW = Date.parse("2026-10-09T12:00:00Z");
const cal = (over: Partial<OfficialCalendar> = {}): OfficialCalendar => ({
  version: 1, fetchedAt: new Date(NOW - 3600_000).toISOString(),
  sources: [{ agency: "BLS", url: "https://www.bls.gov/x.ics", ok: true, fetchedAt: new Date(NOW - 3600_000).toISOString(), events: 2 }, { agency: "FED", url: "https://www.federalreserve.gov/x", ok: true, fetchedAt: new Date(NOW - 3600_000).toISOString(), events: 3 }],
  events: [...parseIcs(BLS, "BLS", "https://www.bls.gov/x.ics"), ...parseFomcPage(FED, "https://www.federalreserve.gov/x")], ...over,
});

describe("official calendar parsing", () => {
  it("BLS ET wall times convert with DST; floating times are refused, not guessed", () => {
    const ev = parseIcs(BLS, "BLS", "u");
    expect(ev.map((e) => e.when)).toEqual(["2026-10-14T12:30:00.000Z", "2026-12-04T13:30:00.000Z"]);
    expect(etWallToUtc(2026, 1, 15, 8, 30)).toBe(Date.parse("2026-01-15T13:30:00Z"));
  });
  it("BEA UTC times and folded/escaped summaries", () => {
    const ev = parseIcs(BEA, "BEA", "u");
    expect(ev[0].name).toBe("Gross Domestic Product, 3rd Quarter 2026 (Advance Estimate)");
    expect(ev[0].when).toBe("2026-10-29T12:30:00.000Z");
  });
  it("FOMC page: meeting end days only; minutes dates, notation votes and footnotes skipped", () => {
    expect(parseFomcPage(FED, "u").map((e) => e.when)).toEqual(["2026-09-16", "2026-10-28", "2026-12-09", "2027-01-27"]);
  });
});

describe("verification is by content, not mtime", () => {
  it("verified with real upcoming major events", () => {
    const v = verifyCalendar(cal(), NOW);
    expect(v.verified).toBe(true);
    expect(v.nextMajor?.name).toBe("Consumer Price Index");
  });
  it("fresh file without any upcoming major event is NOT verified", () => {
    expect(verifyCalendar(cal({ events: parseFomcPage("<b>2025 FOMC Meetings</b> January 28-29", "https://www.federalreserve.gov/x") }), NOW).reason).toBe("official_calendar_no_upcoming_major_event");
  });
  it("stale fetch, failed required source, unsourced event, malformed → not verified", () => {
    expect(verifyCalendar(cal({ fetchedAt: new Date(NOW - 8 * 86400_000).toISOString() }), NOW).reason).toBe("official_calendar_stale");
    const c = cal();
    c.sources[1].ok = false;
    expect(verifyCalendar(c, NOW).reason).toBe("official_source_unverified_FED");
    expect(verifyCalendar(cal({ events: [{ name: "CPI", when: "2026-10-14T12:30:00Z", agency: "BLS", source: "" }] }), NOW).reason).toBe("official_calendar_unsourced_event");
    expect(verifyCalendar({ foo: 1 }, NOW).verified).toBe(false);
    expect(verifyCalendar(null, NOW).verified).toBe(false);
  });
  it("gate: verified calendar vetoes CPI −30/+15 min and the whole FOMC ET day; unverified blocks (fail closed)", () => {
    expect(macroGateOfficial(cal(), NOW)).toMatchObject({ available: true, blocked: false });
    expect(macroGateOfficial(cal(), Date.parse("2026-10-14T12:10:00Z")).blocked).toBe(true);
    expect(macroGateOfficial(cal(), Date.parse("2026-10-14T13:00:00Z")).blocked).toBe(false);
    const t = Date.parse("2026-10-28T15:00:00Z");
    const fresh = new Date(t - 3600_000).toISOString();
    expect(macroGateOfficial(cal(), t).reason).toBe("official_calendar_stale"); // fetched 19 days earlier
    const fomc = macroGateOfficial(cal({ fetchedAt: fresh, sources: cal().sources.map((s) => ({ ...s, fetchedAt: fresh })) }), t);
    expect(fomc.blocked).toBe(true);
    expect(fomc.reason).toBe("verified_macro_event_veto");
    expect(macroGateOfficial(cal({ fetchedAt: "2026-01-01T00:00:00Z" }), NOW)).toMatchObject({ available: false, blocked: true });
  });
  it("macroGate reads the official file format from disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "offcal-"));
    writeFileSync(join(dir, "c.json"), JSON.stringify(cal({ fetchedAt: new Date().toISOString(), sources: cal().sources.map((s) => ({ ...s, fetchedAt: new Date().toISOString() })) })));
    const g = macroGate(Date.now(), join(dir, "c.json"));
    expect(g.available).toBe(Date.now() < Date.parse("2026-12-10T00:00:00Z"));
  });
  it("fetch failures are recorded per source, nothing invented, GET only", async () => {
    const methods: string[] = [];
    const f = (async (_u: string, init?: RequestInit) => {
      methods.push(String(init?.method));
      return new Response("nope", { status: 403 });
    }) as unknown as typeof fetch;
    const c = await fetchOfficialCalendar(f, NOW);
    expect(c.events.length).toBe(0);
    expect(c.sources.every((s) => !s.ok && s.error === "HTTP 403")).toBe(true);
    expect(methods.every((m) => m === "GET")).toBe(true);
    expect(verifyCalendar(c, NOW).verified).toBe(false);
  });
});
