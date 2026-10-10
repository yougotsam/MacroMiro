/**
 * ONE command for the 200-window evaluation (round 3.3):  bun scripts/desk-evaluate.ts
 * Runs scripts/desk-analyze.ts (read-only; no orders, no approvals), then summarizes, per strategy, against
 * executable quotes + real fees vs the Kalshi implied probability, with every CI clustered by independent settlement
 * cluster (BTC/ETH/SOL/XRP at one close = 1 cluster; gold separate).
 * Labelled PRELIMINARY until 200 completed independent settlement windows exist. Reaching 200 promotes nothing:
 * approval stays an owner decision (CALIBRATED_MODEL_APPROVED is not touched here).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { summarizeEvaluation } from "../src/lib/desk/evaluate-summary";

const dir = process.env.DESK_OBSERVE_DIR || "/workspace/data/desk-observe";
const analysisPath = `${dir}/analysis-latest.json`;
if (!process.argv.includes("--no-analyze")) {
  const r = spawnSync("bun", ["scripts/desk-analyze.ts", "--out", analysisPath, "--candidates", "/tmp/desk-eval-candidates"], { stdio: ["ignore", "ignore", "inherit"] });
  if (r.status !== 0) { console.error("desk-analyze failed"); process.exit(1); }
}
const summary = summarizeEvaluation(JSON.parse(readFileSync(analysisPath, "utf8")));
writeFileSync(`${dir}/evaluation-latest.json`, JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary, null, 1));
