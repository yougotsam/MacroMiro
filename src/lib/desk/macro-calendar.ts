/**
 * Scheduled macro-release gate for the desk engine (CPI, FOMC, NFP, PPI…).
 * It can only BLOCK new entries; it never creates, sizes or prices a trade. It reads only the calendar
 * list. A verified major release blocks. A missing, stale or unverified calendar ALSO blocks: no calendar,
 * no trading. A major release whose time has no timezone blocks that whole ET day.
 */
import { readFileSync, statSync } from "node:fs";
import { officialCalendarPath, verifyCalendar, type OfficialCalendar } from "./official-calendar";
import { etDay } from "./time";

export type Scheduled = { name?: string; when?: string };
export type MacroGate = { available: boolean; blocked: boolean; reason: string | null; events: string[] };

const MAJOR = /\b(CPI|consumer price|FOMC|Federal Reserve rate|Fed(?:eral)? funds|nonfarm|non-farm|NFP|employment situation|PPI|producer price)\b/i;
export const CALENDAR_MAX_AGE_MS = 7 * 24 * 3600_000;

/** Date.parse accepts many ambiguous formats; require an explicit timezone for a timed veto. */
function eventMs(raw: string): number | null {
  if (!/\d{4}-\d{2}-\d{2}T\d\d:\d\d.*(?:Z|[+-]\d\d:\d\d)$/.test(raw)) return null;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? at : null;
}

/**
 * The block around a major release, in minutes. Set from the 180-day backtest (data/signal/report.md,
 * "Release window"): see VETO_WINDOW_SOURCE.
 */
export const VETO_WINDOW = Object.freeze({ beforeMin: 15, afterMin: 30 }); // measured: −15..+30 min were the losing buckets (−4.8¢, −19.5¢, −2.8¢); −30..−15 was flat-positive
export const VETO_WINDOW_SOURCE = "measured: data/signal/report.md, section 'Release window'";

/** Major releases from VETO_WINDOW.beforeMin before to VETO_WINDOW.afterMin after their explicit timestamp. */
export function scheduledVeto(events: Scheduled[], now: number): string[] {
  return events
    .filter((e) => {
      const ts = eventMs(e.when ?? "");
      return ts != null && MAJOR.test(e.name ?? "") && ts - VETO_WINDOW.beforeMin * 60_000 <= now && now <= ts + VETO_WINDOW.afterMin * 60_000;
    })
    .map((e) => `${e.name}: ${e.when}`);
}

/** Pure gate over an already-parsed file body. `fileAgeMs` = now − file mtime. */
export function macroGateFrom(raw: unknown, now: number, fileAgeMs: number | null): MacroGate {
  const off = (reason: string): MacroGate => ({ available: false, blocked: true, reason, events: [] });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return off("macro_calendar_unavailable");
  const cal = (raw as { calendar?: { thisWeek?: unknown; nextWeek?: unknown } }).calendar;
  if (!cal || !Array.isArray(cal.thisWeek) || (cal.nextWeek != null && !Array.isArray(cal.nextWeek))) return off("macro_calendar_malformed");
  if (fileAgeMs == null || !Number.isFinite(fileAgeMs) || fileAgeMs < -60_000 || fileAgeMs > CALENDAR_MAX_AGE_MS) return off("macro_calendar_stale");
  const list = [...(cal.thisWeek as Scheduled[]), ...((cal.nextWeek as Scheduled[] | undefined) ?? [])];
  const events = scheduledVeto(list, now);
  const today = etDay(now);
  for (const e of list) {
    if (!e || typeof e !== "object" || !MAJOR.test(String(e.name ?? ""))) continue;
    const when = String(e.when ?? "");
    if (eventMs(when) != null) continue;
    const day = when.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
    if (!day) return off("macro_calendar_unparseable_major_event");
    // time without an explicit timezone: block the whole ET day rather than guess the zone
    if (day === today) events.push(`${e.name}: ${when} (no timezone → whole ET day)`);
  }
  return { available: true, blocked: events.length > 0, reason: events.length ? "verified_macro_event_veto" : null, events };
}

/**
 * Gate over the OFFICIAL calendar (official-calendar.ts): verified by content (sources OK, fetchedAt ≤ 7 d, sourced
 * events, ≥ 1 real upcoming major event), not by file mtime. Unverified or missing BLOCKS. A verified
 * major release vetoes inside VETO_WINDOW.
 */
export function macroGateOfficial(raw: unknown, now: number): MacroGate {
  const v = verifyCalendar(raw, now);
  if (!v.verified) return { available: false, blocked: true, reason: v.reason ?? "official_calendar_unverified", events: [] };
  const evs = (raw as OfficialCalendar).events;
  // reuse the legacy rules: timed events veto −30/+15 min; date-only major events (FOMC day) block the whole ET day
  return macroGateFrom({ calendar: { thisWeek: evs.map((e) => ({ name: e.name, when: e.when })) } }, now, 0);
}

/** Default: the official calendar file. A legacy desk-news-format file is still understood when passed explicitly. */
export function macroGate(now = Date.now(), path = officialCalendarPath()): MacroGate {
  let raw: unknown = null;
  let age: number | null = null;
  try {
    age = now - statSync(path).mtimeMs;
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    raw = null;
  }
  if (raw && typeof raw === "object" && (raw as { version?: unknown }).version === 1 && Array.isArray((raw as { sources?: unknown }).sources)) return macroGateOfficial(raw, now);
  if (path === officialCalendarPath()) return { available: false, blocked: true, reason: raw ? "official_calendar_malformed" : "official_calendar_missing", events: [] };
  return macroGateFrom(raw, now, age);
}
