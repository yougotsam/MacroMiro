import { isMacroKill, loadFfCalendar, redSoon } from "@/lib/live/ff-calendar";

type Hit = { kill: boolean; name: string | null; at: number; ok: boolean };
let cache: Hit | null = null;

async function grab(url: string, timeout = 10_000) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "EnvelopeScan/1.0" },
      signal: AbortSignal.timeout(timeout),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/** FOMC / CPI / NFP / payroll / PCE / Fed rate — sit the window. Cached 2 min. */
export async function macroNewsKill(): Promise<Hit> {
  if (cache && Date.now() - cache.at < 120_000) return cache;
  const xml = await grab("https://nfs.faireconomy.media/ff_calendar_thisweek.xml");
  if (!xml) {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
    const backup = await grab(`https://biquote.io/api/calendar?importance=high&countries=US&from=${from}&to=${to}`);
    const hit = backup && /CPI|FOMC|NFP|Payroll|PCE|Fed/i.test(backup);
    cache = { kill: !!hit, name: hit ? "backup calendar" : null, at: Date.now(), ok: true };
    return cache;
  }
  const cal = await loadFfCalendar(async () => xml);
  const reds = redSoon(cal, Date.now(), 1.5).filter(isMacroKill);
  cache = { kill: reds.length > 0, name: reds[0]?.name ?? null, at: Date.now(), ok: true };
  return cache;
}
