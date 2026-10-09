/**
 * Scheduled macro-release veto for the desk engine (CPI, FOMC, NFP, PPI).
 * It can only BLOCK new entries in a window around an explicitly time-stamped release;
 * it never creates, sizes or prices a trade. It reads only the calendar list from the
 * desk news file and nothing else, so the order path never imports a news/swarm module.
 */
import { readFileSync } from "node:fs";
import { DATA_ROOT } from "@/lib/data-root";

export type Scheduled = { name?: string; when?: string };
const MAJOR = /\b(CPI|consumer price|FOMC|Federal Reserve rate|nonfarm|NFP|employment situation|PPI|producer price)\b/i;

/** Date.parse accepts many ambiguous formats; require an explicit timezone for a trading veto. */
function eventMs(raw: string): number | null {
  if (!/\d{4}-\d{2}-\d{2}T\d\d:\d\d.*(?:Z|[+-]\d\d:\d\d)$/.test(raw)) return null;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? at : null;
}

/** Major releases from 30 min before to 15 min after their explicit timestamp. */
export function scheduledVeto(events: Scheduled[], now: number): string[] {
  return events
    .filter((e) => {
      const ts = eventMs(e.when ?? "");
      return ts != null && MAJOR.test(e.name ?? "") && ts - 30 * 60_000 <= now && now <= ts + 15 * 60_000;
    })
    .map((e) => `${e.name}: ${e.when}`);
}

/** Reads the calendar section only. A missing/unreadable file means no veto (the other gates still apply). */
export function macroVeto(now = Date.now(), path = `${DATA_ROOT}/desk-news.json`): string[] {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as { calendar?: { thisWeek?: Scheduled[]; nextWeek?: Scheduled[] } } | null;
    const cal = raw && typeof raw === "object" ? raw.calendar : undefined;
    const list = [...(Array.isArray(cal?.thisWeek) ? cal!.thisWeek : []), ...(Array.isArray(cal?.nextWeek) ? cal!.nextWeek : [])];
    return scheduledVeto(list, now);
  } catch {
    return [];
  }
}
