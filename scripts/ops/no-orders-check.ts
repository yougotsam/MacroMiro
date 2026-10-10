/** Prints why real orders cannot be sent right now. Read-only.   bun scripts/ops/no-orders-check.ts */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { CALIBRATED_MODEL_APPROVED } from "../../src/lib/desk/config";
import { switchState } from "../../src/lib/desk/risk";
import { readMode } from "../../src/lib/ops/operating-mode";

let collector: Record<string, unknown> = {};
try {
  const last = readFileSync("/workspace/data/desk-observe/observe.log", "utf8").trim().split("\n").reverse().find((l) => l.includes('"net"'));
  if (last) collector = JSON.parse(last.slice(last.indexOf("{")));
} catch { /* none */ }
const procs = execSync("ps -eo args", { encoding: "utf8" }).split("\n");
const engine = procs.filter((p) => /startup\.sh|desk-run|desk-engine|scripts\/desk\.ts/.test(p));
const sw = switchState();
const out = {
  CALIBRATED_MODEL_APPROVED, switches: sw, researchMode: readMode().mode,
  collectorNet: collector.net ?? null, collectorNote: "GET-only fetch guard: any POST/DELETE would be refused and counted",
  engineProcesses: engine.length,
  verdict: !CALIBRATED_MODEL_APPROVED && !sw.live && engine.length === 0 ? "NO REAL ORDERS POSSIBLE" : "CHECK: a lock is open",
};
console.log(JSON.stringify(out, null, 1));
