/**
 * One-command pilot summary: `bun scripts/grid/pilot-summary.ts`
 * Read-only (GET calls only, 0 credits). For each pilot monitor: checks run, actual credits, pages changed/new,
 * judged meaningful vs not (false-alert proxy), detection delay vs publication time where the source gives one,
 * and a projected monthly cost from ACTUAL credits (not Firecrawl's upper-bound estimate).
 * Writes <DATA_ROOT>/research/grid-pilot-summary.json. Research only; cannot trade.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fc } from "../../src/lib/grid/fc.server";
import { DATA_ROOT } from "../../src/lib/data-root";

type Check = { id: string; status: string; trigger: string; startedAt: string; finishedAt: string | null; actualCredits: number | null; summary: Record<string, number> };
type Page = { url: string; status: string; isMeaningful?: boolean | null; judgment?: { meaningful?: boolean; reason?: string } | null; metadata?: { publishedTime?: string; publishedDate?: string } | null; publishedDate?: string };

const saved = JSON.parse(readFileSync(`${DATA_ROOT}/research/grid-monitors.json`, "utf8"));
const start = Date.parse(saved.pilot?.startedAt ?? saved.at);
const end = Math.min(Date.now(), Date.parse(saved.pilot?.endsAt ?? new Date().toISOString()));
const hours = Math.max((end - start) / 3_600_000, 0.01);
const rows = [];
for (const m of saved.monitors.filter((x: { id: string | null }) => x.id)) {
  const r = await fc("GET", `monitor/${m.id}/checks?limit=50`, "monitor");
  const checks = ((r.json.data as Check[]) ?? []).filter((c) => Date.parse(c.startedAt) >= start - 60_000);
  let credits = 0, changed = 0, meaningful = 0, notMeaningful = 0;
  const delays: number[] = [];
  const findings: { url: string; reason: string; delayMin: number | null }[] = [];
  for (const c of checks) {
    credits += c.actualCredits ?? 0;
    if ((c.summary?.changed ?? 0) + (c.summary?.new ?? 0) === 0) continue;
    const d = await fc("GET", `monitor/${m.id}/checks/${c.id}`, "monitor");
    const pages = ((d.json.data as { pages?: Page[] })?.pages ?? []).filter((p) => p.status === "changed" || p.status === "new");
    for (const p of pages) {
      changed++;
      const yes = p.isMeaningful ?? p.judgment?.meaningful ?? null;
      if (yes === true) meaningful++;
      else if (yes === false) notMeaningful++;
      const pub = Date.parse(p.metadata?.publishedTime ?? p.metadata?.publishedDate ?? p.publishedDate ?? "");
      const delay = Number.isFinite(pub) && c.finishedAt ? Math.round((Date.parse(c.finishedAt) - pub) / 60_000) : null;
      if (delay !== null && delay >= 0) delays.push(delay);
      if (yes) findings.push({ url: p.url, reason: String(p.judgment?.reason ?? "").slice(0, 200), delayMin: delay });
    }
  }
  rows.push({
    key: m.key, id: m.id, status: m.status, cron: m.cron, firecrawlEstimatePerMonth: m.estimatedCreditsPerMonth,
    checks: checks.length, failed: checks.filter((c) => c.status === "failed").length, actualCredits: credits,
    projectedPerMonthFromActual: Math.round((credits / hours) * 24 * 30),
    pagesChangedOrNew: changed, judgedMeaningful: meaningful, judgedNotMeaningful: notMeaningful,
    medianDetectionDelayMin: delays.length ? delays.sort((a, b) => a - b)[Math.floor(delays.length / 2)] : null,
    usefulFindings: findings.slice(0, 10),
  });
}
const out = { at: new Date().toISOString(), pilotHours: Math.round(hours * 10) / 10, pilot: saved.pilot, rows, note: "projection from actual credits over a short window; small sample" };
writeFileSync(`${DATA_ROOT}/research/grid-pilot-summary.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify(out, null, 1));
