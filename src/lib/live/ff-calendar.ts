import type { CalEvent } from "./types";

const FF_XML = "https://nfs.faireconomy.media/ff_calendar_thisweek.xml";

function tag(block: string, name: string) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim();
}

function etIso(mdY: string, time: string) {
  const parts = mdY.split(/[-/]/);
  if (parts.length < 3) return new Date().toISOString();
  const [m, d, y] = parts;
  if (/all\s*day/i.test(time) || !time) return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T16:00:00.000Z`;
  const am = /am/i.test(time);
  const pm = /pm/i.test(time);
  const hm = time.replace(/[ap]m/i, "").trim();
  const [hhRaw, mmRaw] = hm.split(":");
  let h = Number(hhRaw);
  const mm = Number(mmRaw || 0);
  if (!Number.isFinite(h)) return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T16:00:00.000Z`;
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  return new Date(
    `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00-04:00`,
  ).toISOString();
}

export function parseFfXml(xml: string): CalEvent[] {
  const blocks = xml.match(/<event>[\s\S]*?<\/event>/gi) ?? [];
  const out: CalEvent[] = [];
  blocks.forEach((b, i) => {
    const title = tag(b, "title");
    const country = tag(b, "country");
    const date = tag(b, "date");
    const time = tag(b, "time");
    const impact = tag(b, "impact");
    if (!title || !date) return;
    out.push({
      id: `ff-${date}-${i}-${title.slice(0, 24)}`,
      name: title,
      time: etIso(date, time),
      country,
      currency: country,
      importance: /high|red/i.test(impact) ? "high" : impact || "low",
      forecast: tag(b, "forecast") || null,
      previous: tag(b, "previous") || null,
      actual: tag(b, "actual") || null,
      sourceUrl: "https://www.forexfactory.com/calendar",
    });
  });
  return out;
}

export async function loadFfCalendar(grab: (url: string, timeout?: number) => Promise<string | null>): Promise<CalEvent[]> {
  const xml = await grab(FF_XML, 10_000);
  if (!xml) return [];
  return parseFfXml(xml);
}

const RED = /CPI|FOMC|NFP|Payroll|PCE|GDP|EIA Crude|ECB|BoJ|Fed |Rate Decision|Unemployment|Non-Farm|Core PCE|ISM/i;

export function redSoon(calendar: CalEvent[], now = Date.now(), hours = 1.5) {
  return calendar.filter((e) => {
    const t = new Date(e.time).getTime();
    if (!Number.isFinite(t)) return false;
    const dt = t - now;
    const high = /high|red/i.test(e.importance) || RED.test(e.name);
    return high && dt > -20 * 60_000 && dt < hours * 3_600_000;
  });
}

export function isMacroKill(e: CalEvent) {
  return /FOMC|CPI|NFP|Payroll|PCE|Rate Decision/i.test(e.name);
}
