/**
 * Curiosity budget: weekly plain-English "what changed and why". Reads loop memory only. NOT scheduled.
 *   bun scripts/loop/weekly-report.ts [--days 7]   → $DATA_ROOT/loop/weekly-<date>.md
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { allLessons, pendingLessons, readJsonl } from "../../src/lib/loop/state";
import { P, loopDir } from "../../src/lib/loop/paths";
import { rejectionRate } from "../../src/lib/loop/checker";
import type { Incident, RunOutcome, Retro } from "../../src/lib/loop/schema";
import type { Verdict } from "../../src/lib/loop/checker";

const i = process.argv.indexOf("--days"); const days = i >= 0 ? Number(process.argv[i + 1]) : 7;
const since = Date.now() - days * 86_400_000, inWin = (at: string) => Date.parse(at) >= since;
const runs = readJsonl<RunOutcome>(P.runs()).filter((r) => inWin(r.at));
const inc = readJsonl<Incident>(P.incidents()).filter((r) => inWin(r.at));
const gates = readJsonl<{ at: string; strategy: string; verdict: Verdict }>(P.gateLog()).filter((r) => inWin(r.at));
const retros = readJsonl<Retro>(P.retros()).filter((r) => inWin(r.at));
const newLessons = allLessons().filter((l) => inWin(l.at));
const rr = rejectionRate(gates);
const usd = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
const md = [
  `# What changed this week (last ${days} days) — ${new Date().toISOString().slice(0, 10)}`, "",
  `- **Runs:** ${runs.length}. Net after AI cost: ${usd(runs.reduce((s, r) => s + r.netUsd, 0))}. AI spend: ${usd(runs.reduce((s, r) => s + r.aiCostUsd, 0))}.`,
  `- **Checker:** ${rr.decisions} decisions, ${rr.rejected} not passed (${rr.rate == null ? "n/a" : (rr.rate * 100).toFixed(0) + "%"}). ${gates.some((g) => g.verdict === "PASS") ? "Something PASSED — owner review needed." : "Nothing passed, so real trading stays off."}`,
  `- **Incidents:** ${inc.length}${inc.length ? ": " + inc.map((x) => `${x.severity} ${x.summary}`).join("; ") : ""}.`,
  `- **Lessons:** ${newLessons.filter((l) => l.status === "active").length} became active, ${newLessons.filter((l) => l.status === "rejected").length} rejected, ${pendingLessons().length} waiting for the checker.`,
  `- **Retros written:** ${retros.length}.`, "",
  "## Why it changed", ...runs.slice(-5).map((r) => `- ${r.at.slice(0, 16)} ${r.engine}/${r.maker}: ${r.trades} trades, ${usd(r.netUsd)} after AI cost; stopped because: ${r.stopReason}.`), "",
  "_Generated from loop files only. Paper/replay numbers, not live fills._", "",
].join("\n");
mkdirSync(loopDir(), { recursive: true });
const f = `${loopDir()}/weekly-${new Date().toISOString().slice(0, 10)}.md`; writeFileSync(f, md); console.log(f); console.log(md);
