/** bun test preload: every test writes into a fresh temp dir, never /workspace/data. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "macromiro-test-"));
process.env.MACROMIRO_DATA_DIR = join(root, "data");
process.env.DESK_DATA_DIR = join(root, "desk");
process.env.MIROFISH_DATA_DIR ??= join(root, "mirofish");
// a fresh risk-watchdog heartbeat so fail-closed entry checks pass in tests (tests that need "stale" inject their own)
process.env.DESK_WATCHDOG_HEARTBEAT = join(root, "loop", "watchdog-heartbeat.json");
mkdirSync(join(root, "loop"), { recursive: true });
writeFileSync(process.env.DESK_WATCHDOG_HEARTBEAT, JSON.stringify({ pid: 0, at: new Date().toISOString(), seq: 1, mode: "paper", ddLimitPct: 50, ddLimitStatus: "PENDING_OWNER_DECISION", last: null }));
