/**
 * Desk engine entry (run with bun). Exactly one instance may run: a PID lock in the data dir.
 *   bun scripts/desk-engine.ts            → trade loop (orders only if kalshi_live=1, kalshi_begin=1, desk_arm=1 and risk passes)
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dataDir } from "../src/lib/desk/config";
import { Engine } from "../src/lib/desk/engine";

const dir = dataDir();
mkdirSync(dir, { recursive: true });
const lock = `${dir}/engine.pid`;
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, "utf8").trim());
  let alive = false;
  try {
    if (pid && pid !== process.pid) {
      process.kill(pid, 0);
      alive = true;
    }
  } catch {
    alive = false;
  }
  if (alive) {
    console.error(`another desk engine is running (pid ${pid}); refusing to start a second order process`);
    process.exit(3);
  }
}
writeFileSync(lock, String(process.pid));
const release = () => {
  try {
    if (readFileSync(lock, "utf8").trim() === String(process.pid)) unlinkSync(lock);
  } catch {
    /* */
  }
};
process.on("exit", release);
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => process.exit(0));

const engine = new Engine();
await engine.start();
const TICK_MS = Number(process.env.DESK_TICK_MS ?? 2000);
setInterval(() => void engine.tick(), TICK_MS);
await engine.tick();
