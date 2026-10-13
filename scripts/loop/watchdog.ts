/**
 * RISK WATCHDOG — its own process, own PID, paper mode only. Polls every 60 s, writes a heartbeat each poll.
 *   bun scripts/loop/watchdog.ts            (loop)      bun scripts/loop/watchdog.ts --once
 * Shares no memory with the engine. If this process dies the heartbeat goes stale and engines refuse NEW entries.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { pollOnce } from "../../src/lib/loop/watchdog-poll";
import { writeHeartbeat, ddLimitPct, HEARTBEAT_EVERY_MS, DD_LIMIT_PENDING_OWNER_DECISION } from "../../src/lib/loop/watchdog";
import { loopDir, P } from "../../src/lib/loop/paths";

mkdirSync(loopDir(), { recursive: true });
writeFileSync(P.watchdogPid(), String(process.pid));
let seq = 0;
async function tick() {
  let last;
  // fail closed: NO heartbeat when a poll fails, so repeated failures go stale and engines refuse new entries
  try { last = await pollOnce(); } catch (e) { console.error(new Date().toISOString(), "poll error (no heartbeat)", (e as Error).message); return; }
  writeHeartbeat({ pid: process.pid, at: new Date().toISOString(), seq: ++seq, mode: "paper", ddLimitPct: ddLimitPct(), ddLimitStatus: DD_LIMIT_PENDING_OWNER_DECISION ? "PENDING_OWNER_DECISION" : "OWNER_SET", last });
  if (last?.actions.length) console.log(new Date().toISOString(), last.actions.join(" | "));
}
await tick();
if (!process.argv.includes("--once")) setInterval(tick, HEARTBEAT_EVERY_MS);
