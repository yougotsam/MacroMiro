/** Create grid monitors once (idempotent by key), record Firecrawl's estimatedCreditsPerMonth, keep the combined
 * estimate under GRID_MONITOR_CAP by pausing the rest. Map the Fed section first (1 credit) to confirm paths. */
import { mkdirSync, writeFileSync } from "node:fs";
import { fc } from "../../src/lib/grid/fc.server";
import { MONITORS, GRID_MONITOR_CAP, createBody, type CreatedMonitor } from "../../src/lib/grid/monitors";
import { readMonitors, MONITOR_FILE } from "../../src/lib/grid/monitor-sync.server";
import { DATA_ROOT } from "../../src/lib/data-root";

const map = await fc("POST", "map", "map", { url: "https://www.federalreserve.gov/newsevents/pressreleases.htm", limit: 30, search: "pressreleases" }, { paid: true });
const links = ((map.json.links as (string | { url: string })[] | undefined) ?? []).map((l) => (typeof l === "string" ? l : l.url));
console.log("map:", map.http, map.credits, "credits,", links.length, "links; sample", links.filter((l) => /pressreleases\//.test(l)).slice(0, 3));

const prev = readMonitors()?.monitors ?? [];
const out: CreatedMonitor[] = [];
let total = 0;
for (const def of [...MONITORS].sort((a, b) => Number(b.essential) - Number(a.essential))) {
  const had = prev.find((p) => p.key === def.key && p.id);
  if (had) {
    out.push(had);
    if (had.status === "active") total += had.estimatedCreditsPerMonth ?? 0;
    continue;
  }
  const r = await fc("POST", "monitor", "monitor", createBody(def), { paid: true });
  const d = (r.json.data ?? {}) as { id?: string; estimatedCreditsPerMonth?: number };
  if (!r.ok || !d.id) {
    out.push({ key: def.key, id: null, estimatedCreditsPerMonth: null, status: "not_created", cron: def.cron, reason: r.error });
    continue;
  }
  const est = Number(d.estimatedCreditsPerMonth ?? 0);
  if (total + est <= GRID_MONITOR_CAP) {
    total += est;
    out.push({ key: def.key, id: d.id, estimatedCreditsPerMonth: est, status: "active", cron: def.cron, reason: def.why });
  } else {
    const p = await fc("PATCH", `monitor/${d.id}`, "monitor", { status: "paused" });
    out.push({ key: def.key, id: d.id, estimatedCreditsPerMonth: est, status: p.ok ? "paused" : "active", cron: def.cron, reason: `over the ${GRID_MONITOR_CAP}/month cap: built disabled, needs Sameer's approval${p.ok ? "" : " (PAUSE FAILED: " + p.error + ")"}` });
  }
  await new Promise((s) => setTimeout(s, 7000));
}
mkdirSync(`${DATA_ROOT}/research`, { recursive: true });
writeFileSync(MONITOR_FILE(), JSON.stringify({ at: new Date().toISOString(), cap: GRID_MONITOR_CAP, activeEstimate: total, mapLinks: links.length, monitors: out }, null, 1));
console.log(JSON.stringify(out, null, 1), "\nactive estimate", total);
