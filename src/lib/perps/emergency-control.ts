import { appendFileSync, closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { performance } from "node:perf_hooks";

// These files belong on the same persistent, local filesystem as the OMS journal.
// A crashed writer leaves a visible lease. Age alone cannot prove a send was lost.
function exclusiveFile(path: string, value: string) {
  try {
    writeFileSync(path, value, { flag: "wx", mode: 0o600, flush: true });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw e;
  }
}

function syncDirectory(path: string) {
  const fd = openSync(path, "r");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

type HaltCause = "OPERATOR_HALT" | "HEARTBEAT_LOST" | "RECONCILIATION_FAILED";
export type PerpsIncident = HaltCause | "HALT_UNCONFIRMED" | "SUBMISSIONS_UNRESOLVED" | "CANCEL_UNVERIFIED" |
  "POSITIONS_UNVERIFIED" | "FLATTEN_UNVERIFIED" | "TRIGGER_CLEANUP_UNVERIFIED";

export function reportPerpsIncident(journal: string | null, code: PerpsIncident) {
  // Only local incident codes enter the durable alert stream. Venue payloads
  // and provider error text are not operator records.
  const line = JSON.stringify({ at: new Date().toISOString(), severity: "SEV1", state: "UNKNOWN", code });
  console.error(line);
  if (journal) appendFileSync(journal + ".alerts.jsonl", line + "\n", { mode: 0o600, flush: true });
}

/** The separate watchdog can deliver an operator page even if the worker is
 * stalled. The receiver can deduplicate retries using the stable incident ID. */
export async function pagePerpsStop(journal: string, webhook: string, send: typeof fetch = fetch) {
  const url = new URL(webhook);
  if (url.protocol !== "https:") throw new Error("operator alert endpoint requires HTTPS");
  const file = journal + ".kill";
  const { ino, mtimeMs } = statSync(file);
  const id = createHash("sha256").update(`${ino}:${mtimeMs}:` + readFileSync(file, "utf8")).digest("hex");
  const receipt = journal + ".paged";
  if (statSync(receipt, { throwIfNoEntry: false }) && readFileSync(receipt, "utf8") === id) return;
  const result = await send(url, { method: "POST", redirect: "error", signal: AbortSignal.timeout(3_000),
    headers: { "Content-Type": "application/json", "Idempotency-Key": id },
    body: JSON.stringify({ id, severity: "SEV1", desk: "Macro Miro perps", message: "Emergency stop latched. Verify venue exposure and protective exits." }) });
  if (!result.ok) throw new Error("operator alert endpoint returned " + result.status);
  writeFileSync(receipt, id, { mode: 0o600, flush: true });
}

export class PerpsSubmissionBarrier {
  private killed = false;
  private active = new Set<string>();
  private flattening = false;
  constructor(private journal: string | null) {}

  get latched() {
    return this.killed || !!(this.journal && statSync(this.journal + ".kill", { throwIfNoEntry: false }));
  }

  latch(reason: HaltCause) {
    this.killed = true;
    if (this.journal) {
      exclusiveFile(this.journal + ".kill", JSON.stringify({ reason, at: new Date().toISOString() }) + "\n");
      syncDirectory(dirname(this.journal));
    }
  }

  // Register first and recheck the latch. A concurrent kill either sees this
  // lease in its drain, or this caller sees the latch before it can dispatch.
  enter(key: string, reducing = false): (() => void) | null {
    const barred = () => reducing
      ? this.flattening || !!(this.journal && statSync(this.journal + ".flattening", { throwIfNoEntry: false }))
      : this.latched;
    if (barred() || this.active.has(key)) return null;
    let path: string | undefined;
    if (this.journal) {
      const dir = this.journal + ".inflight";
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      path = join(dir, createHash("sha256").update(key).digest("hex"));
      if (!exclusiveFile(path, JSON.stringify({ key, host: hostname(), pid: process.pid }))) return null;
      syncDirectory(dir);
    }
    this.active.add(key);
    const release = () => {
      if (path) unlinkSync(path);
      this.active.delete(key);
    };
    if (barred()) { release(); return null; }
    return release;
  }

  claimFlatten(): (() => void) | null {
    if (this.flattening || (this.journal && !exclusiveFile(this.journal + ".flattening", String(process.pid)))) return null;
    this.flattening = true;
    return () => {
      if (this.journal) unlinkSync(this.journal + ".flattening");
      this.flattening = false;
    };
  }

  async drain(timeoutMs: number, sentWithoutAck: (cid: string) => boolean) {
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      let busy = this.active.size > 0;
      if (!busy && this.journal) {
        const dir = this.journal + ".inflight";
        if (statSync(dir, { throwIfNoEntry: false })) {
          for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            try {
              const owner = JSON.parse(readFileSync(path, "utf8"));
              if (owner.host === hostname() && Number.isSafeInteger(owner.pid) && owner.pid > 0 && sentWithoutAck(owner.key)) {
                try { process.kill(owner.pid, 0); }
                catch (e) {
                  if ((e as NodeJS.ErrnoException).code === "ESRCH") { unlinkSync(path); continue; }
                }
              }
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
            }
            busy = true;
          }
        }
      }
      if (!busy) return true;
      const left = deadline - performance.now();
      if (left <= 0) return false;
      await sleep(Math.min(left, 25));
    }
  }
}

// Only a completed venue reconciliation advances this heartbeat.
export const PERPS_HEARTBEAT_STALE_MS = 15_000;
function writeBeat(file: string, now: number) {
  const tmp = file + "." + randomUUID();
  writeFileSync(tmp, JSON.stringify({ at: now }), { mode: 0o600 });
  renameSync(tmp, file);
}
export function beatPerpsWorker(journal: string, now = Date.now()) { writeBeat(journal + ".heartbeat", now); }
function freshBeat(file: string, now: number) {
  try {
    const { at } = JSON.parse(readFileSync(file, "utf8"));
    return typeof at === "number" && Number.isFinite(at) && at <= now && now - at < PERPS_HEARTBEAT_STALE_MS;
  } catch { return false; }
}
export function perpsSupervisionFresh(journal: string, now = Date.now()) {
  return freshBeat(journal + ".heartbeat", now) && freshBeat(journal + ".watchdog", now);
}

export function perpsWatchdogTick(journal: string, now = Date.now()) {
  const barrier = new PerpsSubmissionBarrier(journal);
  if (barrier.latched) return { ok: false, why: "perps emergency stop latched" };
  if (freshBeat(journal + ".heartbeat", now)) {
    writeBeat(journal + ".watchdog", now);
    return { ok: true, why: "venue reconciliation heartbeat fresh" };
  }
  const why = "venue reconciliation heartbeat missing, invalid or stale";
  barrier.latch("HEARTBEAT_LOST");
  reportPerpsIncident(journal, "HEARTBEAT_LOST");
  return { ok: false, why };
}
