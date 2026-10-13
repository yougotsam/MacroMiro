/**
 * Official, timestamped macro calendar (round 3.1 Phase 1a).
 * Sources (public GET only): BLS release schedule (iCalendar, ET times — CPI, PPI, Employment Situation…),
 * BEA release schedule (iCalendar, UTC times — GDP, PCE/Personal Income…), Federal Reserve FOMC calendar page
 * (meeting dates; the page gives no time, so the decision day is a whole-ET-day event).
 * Verification is about CONTENT, not file mtime: every required source fetched OK within the max age, every event
 * carries its source URL, and there is at least one real UPCOMING major event. Anything else → not verified →
 * the trading gate fails closed. The collector never depends on this (it only records the gate result).
 */
import { DATA_ROOT } from "@/lib/data-root";

export type OfficialEvent = {
  name: string;
  /** ISO with explicit offset when the source gives a time; plain YYYY-MM-DD when it gives only a date */
  when: string;
  agency: "BLS" | "BEA" | "FED";
  source: string;
};
export type SourceStatus = { agency: OfficialEvent["agency"]; url: string; ok: boolean; fetchedAt: string; events: number; error?: string };
export type OfficialCalendar = { version: 1; fetchedAt: string; sources: SourceStatus[]; events: OfficialEvent[] };

export const OFFICIAL_SOURCES = {
  BLS: "https://www.bls.gov/schedule/news_release/bls.ics",
  BEA: "https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics",
  FED: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
} as const;
export const REQUIRED_AGENCIES: OfficialEvent["agency"][] = ["BLS", "FED"];
export const OFFICIAL_MAX_AGE_MS = 7 * 24 * 3600_000;
export const UPCOMING_HORIZON_MS = 45 * 24 * 3600_000;
export const MAJOR_EVENT = /\b(CPI|consumer price|FOMC|Federal Reserve rate|Fed(?:eral)? funds|nonfarm|non-farm|NFP|employment situation|PPI|producer price)\b/i;
export const officialCalendarPath = () => `${DATA_ROOT}/macro-calendar.json`;

/** UTC ms for a wall-clock time in America/New_York (DST-correct; tries both offsets). */
export function etWallToUtc(y: number, mo: number, d: number, hh: number, mm: number): number {
  for (const off of [4, 5]) {
    const t = Date.UTC(y, mo - 1, d, hh + off, mm);
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(t);
    const g = (k: string) => Number(p.find((x) => x.type === k)?.value);
    if (g("year") === y && g("month") === mo && g("day") === d && g("hour") % 24 === hh && g("minute") === mm) return t;
  }
  throw new Error(`no ET instant for ${y}-${mo}-${d} ${hh}:${mm}`);
}

/** RFC 5545 unfolding + VEVENT extraction (SUMMARY, DTSTART with TZID=US-Eastern / America/New_York, or UTC Z). */
export function parseIcs(text: string, agency: OfficialEvent["agency"], source: string): OfficialEvent[] {
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out: OfficialEvent[] = [];
  let cur: { summary?: string; start?: string; tz?: string | null } | null = null;
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") cur = {};
    else if (l === "END:VEVENT" && cur) {
      const when = cur.start ? icsWhen(cur.start, cur.tz ?? null) : null;
      if (cur.summary && when) out.push({ name: cur.summary.replace(/\\([,;\\])/g, "$1").trim(), when, agency, source });
      cur = null;
    } else if (cur && l.startsWith("SUMMARY")) cur.summary = l.slice(l.indexOf(":") + 1);
    else if (cur && l.startsWith("DTSTART")) {
      const head = l.slice(0, l.indexOf(":"));
      cur.start = l.slice(l.indexOf(":") + 1).trim();
      cur.tz = head.match(/TZID=([^;:]+)/)?.[1] ?? null;
    }
  }
  return out;
}

function icsWhen(v: string, tz: string | null): string | null {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (m[4] == null) return `${m[1]}-${m[2]}-${m[3]}`;
  if (m[7] === "Z") return new Date(Date.UTC(y, mo - 1, d, Number(m[4]), Number(m[5]))).toISOString();
  if (tz && /US-Eastern|America\/New_York/i.test(tz)) return new Date(etWallToUtc(y, mo, d, Number(m[4]), Number(m[5]))).toISOString();
  return null; // floating or unknown zone: refuse to guess
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** FOMC meetings from the Fed's calendar page: decision day = last day of each meeting (date only, no time on page). */
export function parseFomcPage(html: string, source: string): OfficialEvent[] {
  const text = html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const out: OfficialEvent[] = [];
  const re = /(\d{4}) FOMC Meetings(.*?)(?=\d{4} FOMC Meetings|$)/g;
  for (const sec of text.matchAll(re)) {
    const year = Number(sec[1]);
    // stop at footnotes / page footer ("Note: … January 25-26, 2028", "Last Update: October 07, 2026")
    const body = sec[2].split(/\bNote:|Back to Top|Last Update/)[0];
    const mre = new RegExp(`\\b(${MONTHS.join("|")})(?:/(${MONTHS.join("|")}))? (\\d{1,2})(?:-(?:(${MONTHS.join("|")}) )?(\\d{1,2}))?(\\*)?( \\(notation vote\\)| \\(unscheduled\\))?`, "g");
    for (const m of body.matchAll(mre)) {
      if (m[7]) continue; // notation votes / unscheduled entries are not scheduled releases
      if (/^\s*\(Released/.test(body.slice((m.index ?? 0) - 10, m.index))) continue;
      const before = body.slice(Math.max(0, (m.index ?? 0) - 12), m.index);
      if (/Released\s*$/.test(before)) continue; // "(Released October 07, 2026)" = minutes date, not a meeting
      if (/^,\s*\d{4}/.test(body.slice((m.index ?? 0) + m[0].length))) continue; // a dated reference, not a meeting row
      const endMonth = m[4] ?? m[2] ?? m[1];
      const day = Number(m[5] ?? m[3]);
      const mo = MONTHS.indexOf(endMonth) + 1;
      if (!mo || day < 1 || day > 31) continue;
      out.push({ name: "FOMC rate decision (meeting end day; time not on source page)", when: `${year}-${String(mo).padStart(2, "0")}-${String(day).padStart(2, "0")}`, agency: "FED", source });
    }
  }
  return [...new Map(out.map((e) => [e.when, e])).values()];
}

const eventMs = (when: string) => (/T\d\d:\d\d.*(Z|[+-]\d\d:\d\d)$/.test(when) ? Date.parse(when) : /^\d{4}-\d{2}-\d{2}$/.test(when) ? Date.parse(`${when}T23:59:59-04:00`) : NaN);

export type CalendarVerdict = { verified: boolean; reason: string | null; upcomingMajor: number; nextMajor: OfficialEvent | null; ageMs: number | null };

export function verifyCalendar(raw: unknown, now: number): CalendarVerdict {
  const no = (reason: string, ageMs: number | null = null): CalendarVerdict => ({ verified: false, reason, upcomingMajor: 0, nextMajor: null, ageMs });
  if (!raw || typeof raw !== "object") return no("official_calendar_missing");
  const c = raw as Partial<OfficialCalendar>;
  if (c.version !== 1 || !Array.isArray(c.events) || !Array.isArray(c.sources) || typeof c.fetchedAt !== "string") return no("official_calendar_malformed");
  const fetched = Date.parse(c.fetchedAt);
  if (!Number.isFinite(fetched)) return no("official_calendar_malformed");
  const age = now - fetched;
  if (age < -60_000 || age > OFFICIAL_MAX_AGE_MS) return no("official_calendar_stale", age);
  for (const a of REQUIRED_AGENCIES) {
    const s = c.sources.find((x) => x.agency === a);
    if (!s || !s.ok || !Number.isFinite(Date.parse(s.fetchedAt)) || now - Date.parse(s.fetchedAt) > OFFICIAL_MAX_AGE_MS) return no(`official_source_unverified_${a}`, age);
  }
  for (const e of c.events) if (!e || typeof e.name !== "string" || typeof e.when !== "string" || typeof e.source !== "string" || !/^https:\/\//.test(e.source)) return no("official_calendar_unsourced_event", age);
  const upcoming = c.events.filter((e) => MAJOR_EVENT.test(e.name) && Number.isFinite(eventMs(e.when)) && eventMs(e.when) >= now && eventMs(e.when) <= now + UPCOMING_HORIZON_MS).sort((a, b) => eventMs(a.when) - eventMs(b.when));
  if (!upcoming.length) return no("official_calendar_no_upcoming_major_event", age);
  return { verified: true, reason: null, upcomingMajor: upcoming.length, nextMajor: upcoming[0], ageMs: age };
}

/** Fetch all sources (GET only). A failed source is recorded, never invented. */
export async function fetchOfficialCalendar(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<OfficialCalendar> {
  const headers = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) macromiro-desk-calendar", accept: "text/calendar,text/html;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.9" };
  const sources: SourceStatus[] = [];
  const events: OfficialEvent[] = [];
  for (const [agency, url] of Object.entries(OFFICIAL_SOURCES) as Array<[OfficialEvent["agency"], string]>) {
    const at = new Date().toISOString();
    try {
      const r = await fetchImpl(url, { method: "GET", headers, signal: AbortSignal.timeout(20_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.text();
      const ev = agency === "FED" ? parseFomcPage(body, url) : parseIcs(body, agency, url);
      if (!ev.length) throw new Error("no events parsed");
      events.push(...ev);
      sources.push({ agency, url, ok: true, fetchedAt: at, events: ev.length });
    } catch (e) {
      sources.push({ agency, url, ok: false, fetchedAt: at, events: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { version: 1, fetchedAt: new Date(now).toISOString(), sources, events };
}
