/**
 * Daily reports: bias (6 AM), scan (7 AM), review (4 PM), weekly scorecard. New York times; run from cron.
 * Writes markdown to data/reports/<kind>-<date>.md. Reads only local files (bars, model, decisions); never sends.
 * Usage: bun scripts/desk-reports.ts bias|scan|review|weekly
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { preTrade } from "../src/lib/signal/checklist";
import { readNewsDocs, releaseTimes } from "../src/lib/signal/news";
import { dailyBiasBrief, killzoneBrief, reviewBrief } from "../src/lib/signal/prompts";
import { loadSignalModel, readBars, readNewsHistory, REPO_ROOT } from "../src/lib/signal/store";
import { DATA_ROOT } from "../src/lib/data-root";

const ASSETS = ["BTC", "ETH", "SOL", "XRP", "GOLD"] as const;
const kind = process.argv[2] ?? "bias";
const now = Date.now();
const day = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const out = `${REPO_ROOT}/data/reports`;
mkdirSync(out, { recursive: true });

function checks() {
  const file = loadSignalModel(now);
  const docs = readNewsDocs();
  const rel = releaseTimes(undefined, now);
  return ASSETS.map((a) => {
    // read-only brief at the real clock: a stale bar file shows up as "data not ready", it is not hidden
    return preTrade({ asset: a, product: "prediction", bars: readBars(a), now, releases: rel, docs, hist: readNewsHistory(a, now), file });
  });
}

type Row = { ts?: string; series?: string; action?: string; failed_gate?: string | null; best?: unknown; checklist?: { bias?: string; edge?: number | null } | null };
function decisions(fromMs: number): Row[] {
  const f = `${DATA_ROOT}/desk/decisions.jsonl`;
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).flatMap((l) => {
    try {
      const r = JSON.parse(l) as Row;
      return Date.parse(r.ts ?? "") >= fromMs ? [r] : [];
    } catch {
      return [];
    }
  });
}

let md = "";
if (kind === "bias" || kind === "scan") {
  const cs = checks();
  md = `# ${kind === "bias" ? "Daily bias" : "Killzone scan"} — ${day}\n\n| Asset | Bias | Chance up | Edge | Ready | Why |\n|---|---|---|---|---|---|\n`;
  for (const c of cs) md += `| ${c.asset} | ${c.bias} | ${c.pUp == null ? "—" : (c.pUp * 100).toFixed(1) + "%"} | ${c.edge == null ? "—" : (c.edge * 100).toFixed(1) + "¢"} | ${c.fire ? "yes" : "no"} | ${c.why} |\n`;
  for (const c of cs) {
    const b = kind === "bias" ? dailyBiasBrief(c) : killzoneBrief(c);
    md += `\n## ${b.title}\n\n\`\`\`\n${b.text}\n\`\`\`\n`;
  }
} else if (kind === "review" || kind === "weekly") {
  const from = now - (kind === "weekly" ? 7 : 1) * 86_400_000;
  const rows = decisions(from);
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.failed_gate ?? r.action ?? "?", (by.get(r.failed_gate ?? r.action ?? "?") ?? 0) + 1);
  const ready = rows.filter((r) => r.best).length;
  const summary = `Decisions: ${rows.length}. Ready to send: ${ready}.\nTop reasons:\n${[...by].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`;
  md = `# ${kind === "weekly" ? "Weekly scorecard" : "Daily review"} — ${day}\n\n${summary}\n\nSettled P/L comes from Kalshi's records (scripts/signal-train.ts refits weekly from the logged vectors).\n\n\`\`\`\n${reviewBrief(summary).text}\n\`\`\`\n`;
} else {
  console.error("usage: bias|scan|review|weekly");
  process.exit(2);
}
const path = `${out}/${kind}-${day}.md`;
writeFileSync(path, md);
console.log(path);
