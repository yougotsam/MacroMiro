/**
 * The only way to PROPOSE CALIBRATED_MODEL_APPROVED=true: the latest strategy-gate decision must be PASS.
 * It writes a proposal file for the owner. It never edits config.ts and never touches switch files.
 *   bun scripts/loop/propose-approval.ts [strategy]
 */
import { writeFileSync } from "node:fs";
import { readJsonl } from "../../src/lib/loop/state";
import { P, loopDir } from "../../src/lib/loop/paths";
import { proposeCalibratedApproval, type GateReport } from "../../src/lib/loop/checker";
import { CALIBRATED_MODEL_APPROVED } from "../../src/lib/desk/config";

const strategy = process.argv[2];
const rows = readJsonl<{ strategy: string; verdict: GateReport["verdict"]; stats: GateReport["stats"]; at: string }>(P.gateLog()).filter((r) => !strategy || r.strategy === strategy);
const last = rows.at(-1);
const r = proposeCalibratedApproval(last ? ({ verdict: last.verdict, stats: last.stats, at: last.at } as GateReport) : null);
console.log(JSON.stringify({ current: CALIBRATED_MODEL_APPROVED, strategy: last?.strategy ?? null, ...r }, null, 1));
if (r.allowed) writeFileSync(`${loopDir()}/approval-proposal.json`, JSON.stringify(r.proposal, null, 1));
process.exit(r.allowed ? 0 : 2);
