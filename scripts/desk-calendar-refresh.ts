/**
 * Refresh the OFFICIAL macro calendar (BLS + BEA iCalendar, Fed FOMC page). Public GET only; no keys; no orders.
 *   bun scripts/desk-calendar-refresh.ts            one refresh, prints the verdict
 *   bun scripts/desk-calendar-refresh.ts --loop 6   refresh every 6 h (background: nohup … &)
 * Writes atomically to <DATA_ROOT>/macro-calendar.json. If a refresh fails, the previous file is kept as-is: it ages
 * out after 7 days and the TRADING gate then fails closed. The read-only collector never waits on this.
 */
import { renameSync, writeFileSync } from "node:fs";
import { fetchOfficialCalendar, officialCalendarPath, verifyCalendar } from "../src/lib/desk/official-calendar";
import { installReadOnlyFetch } from "../src/lib/desk/net-guard";

installReadOnlyFetch();
const args = process.argv.slice(2);
const loopH = args.includes("--loop") ? Number(args[args.indexOf("--loop") + 1] ?? 6) : 0;

async function once() {
  const cal = await fetchOfficialCalendar();
  const v = verifyCalendar(cal, Date.now());
  const path = officialCalendarPath();
  const okSources = cal.sources.filter((s) => s.ok).length;
  if (okSources > 0) {
    writeFileSync(`${path}.tmp`, JSON.stringify(cal, null, 1));
    renameSync(`${path}.tmp`, path);
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), written: okSources > 0, sources: cal.sources.map((s) => ({ agency: s.agency, ok: s.ok, events: s.events, error: s.error })), verdict: v }));
}

await once();
if (loopH > 0) setInterval(() => void once().catch((e) => console.error(new Date().toISOString(), "refresh failed", String(e))), loopH * 3600_000);
