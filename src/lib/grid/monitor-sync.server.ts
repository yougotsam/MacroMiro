/** Poll grid monitors' checks (no webhook needed: the box is not publicly reachable), record actual credits, and
 * turn meaningful page changes into evidence. Also pauses nonessential grid monitors when the monthly ceiling hits. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { DATA_ROOT } from "@/lib/data-root";
import { fc } from "@/lib/grid/fc.server";
import { recordCredits, budgetNow } from "@/lib/intel/budget.server";
import { storeEvidence } from "@/lib/grid/evidence";
import { MONITORS, type CreatedMonitor } from "@/lib/grid/monitors";

export const MONITOR_FILE = () => `${DATA_ROOT}/research/grid-monitors.json`;

export function readMonitors(): { at: string; monitors: CreatedMonitor[] } | null {
  try {
    return JSON.parse(readFileSync(MONITOR_FILE(), "utf8"));
  } catch {
    return null;
  }
}

export async function syncMonitors() {
  const saved = readMonitors();
  if (!saved) return { synced: 0, changes: 0, paused: [] as string[] };
  let changes = 0;
  const paused: string[] = [];
  const suspend = budgetNow().suspendNonessential;
  for (const m of saved.monitors) {
    if (!m.id) continue;
    const def = MONITORS.find((d) => d.key === m.key);
    if (suspend && def && !def.essential && m.status === "active") {
      const r = await fc("PATCH", `monitor/${m.id}`, "monitor", { status: "paused" });
      if (r.ok) {
        m.status = "paused";
        m.reason = "auto-paused: monthly Firecrawl credit ceiling reached";
        paused.push(m.key);
      }
    }
    const r = await fc("GET", `monitor/${m.id}/checks?limit=5`, "monitor");
    const checks = (r.json.data as { id: string; actualCredits?: number; status: string; finishedAt?: string; summary?: { changed?: number; new?: number } }[] | undefined) ?? [];
    for (const c of checks) {
      if (c.actualCredits) recordCredits(`monitor:${m.key}`, c.actualCredits, new Date(c.finishedAt ?? Date.now()), `check:${c.id}`);
      if ((c.summary?.changed ?? 0) + (c.summary?.new ?? 0) > 0) {
        const detail = await fc("GET", `monitor/${m.id}/checks/${c.id}`, "monitor");
        const pages = ((detail.json.data as { pages?: { url: string; status: string; isMeaningful?: boolean; judgment?: { reason?: string } }[] })?.pages ?? []).filter((p) => p.isMeaningful !== false && (p.status === "changed" || p.status === "new"));
        for (const p of pages) {
          const s = storeEvidence({ kind: "monitor_change", sourceUrl: p.url, title: `${m.key}: ${p.status}`, publishedAt: null, detectedAt: c.finishedAt ?? new Date().toISOString(), jobIds: { monitorId: m.id, checkId: c.id }, related: [], summary: String(p.judgment?.reason ?? "").slice(0, 400), payload: { status: p.status }, body: `${c.id}|${p.url}|${p.status}` });
          if (s.stored) changes++;
        }
      }
    }
  }
  mkdirSync(`${DATA_ROOT}/research`, { recursive: true });
  writeFileSync(MONITOR_FILE(), JSON.stringify({ ...saved, syncedAt: new Date().toISOString() }, null, 1));
  return { synced: saved.monitors.length, changes, paused };
}
