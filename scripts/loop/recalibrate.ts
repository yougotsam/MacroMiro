/**
 * Verification-rot recalibration: did the gates approve the trades that made money?
 *   bun scripts/loop/recalibrate.ts   → $DATA_ROOT/loop/recalibration-latest.json
 * Source today: the Kalshi paper replay (paper-latest.json). "approved" = the candidate's EV gate said > 0 (what the
 * entry gate trades on); outcome = realized after-fee net once settled. Precision falling week over week = rot.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { DATA_ROOT } from "../../src/lib/data-root";
import { byWeek, precisionRecall, type GateOutcome } from "../../src/lib/loop/recalibrate";
import { loopDir } from "../../src/lib/loop/paths";

const paper = JSON.parse(readFileSync(`${process.env.MACROMIRO_DATA_DIR || DATA_ROOT}/paper/paper-latest.json`, "utf8")) as { configs: { id: string; recent: { ts: string; evUsd: number; netUsd: number | null }[] }[] };
const out: Record<string, unknown> = {};
for (const c of paper.configs) {
  const rows: GateOutcome[] = c.recent.map((t) => ({ at: t.ts, approved: t.evUsd > 0, netUsd: t.netUsd }));
  out[c.id] = { overall: precisionRecall(rows), byWeek: byWeek(rows) };
}
mkdirSync(loopDir(), { recursive: true });
const rep = { at: new Date().toISOString(), note: "paper-latest keeps only the last 40 entries per config; approved = EV gate > 0", configs: out };
writeFileSync(`${loopDir()}/recalibration-latest.json`, JSON.stringify(rep, null, 1));
console.log(JSON.stringify(rep, null, 1));
