/** Loop-engineering file locations. Tests set MACROMIRO_DATA_DIR to a temp dir (test/preload.ts). */
import { DATA_ROOT } from "@/lib/data-root";
export const loopDir = () => `${process.env.MACROMIRO_DATA_DIR || DATA_ROOT}/loop`;
export const P = {
  state: () => `${loopDir()}/STATE.md`,
  stateJson: () => `${loopDir()}/state.json`,
  lessons: () => `${loopDir()}/lessons.jsonl`,
  pending: () => `${loopDir()}/pending-lessons.jsonl`,
  retros: () => `${loopDir()}/retros.jsonl`,
  incidents: () => `${loopDir()}/incidents.jsonl`,
  runs: () => `${loopDir()}/runs.jsonl`,
  gateLog: () => `${loopDir()}/gate-decisions.jsonl`,
  heartbeat: () => process.env.DESK_WATCHDOG_HEARTBEAT || `${loopDir()}/watchdog-heartbeat.json`,
  watchdogPid: () => `${loopDir()}/watchdog.pid`,
  paperKill: () => `${loopDir()}/paper-kill.json`,
  budget: () => `${loopDir()}/loop-budget.jsonl`,
};
