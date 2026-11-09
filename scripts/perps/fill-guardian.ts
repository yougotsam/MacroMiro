/**
 * Run ONLY on the persistent trading runtime, not a stateless Vercel function.
 * Protects already-filled positions; does not submit entries. Requires signed
 * venue credentials on the machine and shared durable OMS journal path.
 *
 * MACROMIRO_PROTECTION_WORKER=1 bun scripts/perps/fill-guardian.ts
 * The actual live route remains disabled until an end-to-end demo review.
 */
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { DATA_ROOT } from "../../src/lib/data-root";
import { liveMarginTransport } from "../../src/lib/perps/live-transport";
import { PerpsOms } from "../../src/lib/perps/oms";
import { reconcileFilledProtection } from "../../src/lib/perps/fill-guardian";

if (process.env.MACROMIRO_PROTECTION_WORKER !== "1") {
  throw new Error("Protection worker is opt-in; MACROMIRO_PROTECTION_WORKER=1 required");
}
const journal = process.env.MACROMIRO_PERPS_JOURNAL ?? `${DATA_ROOT}/perps/oms.jsonl`;
if (!existsSync(journal)) throw new Error("Persistent OMS journal missing; no exchange writes permitted");
const periodMs = 1_000;
while (true) {
  const oms = new PerpsOms(liveMarginTransport, journal, true, () => ({ ok: false, why: "guardian never sends entries" }));
  const r = await reconcileFilledProtection(oms, liveMarginTransport);
  process.stdout.write(JSON.stringify({ at: new Date().toISOString(), ...r }) + "\n");
  if (r.status !== "OK") {
    process.stderr.write("SEV1: Exchange position lacks independently confirmed protection. New entries latched; reconcile and reduce exposure.\n");
    process.exitCode = 2;
    break;
  }
  await sleep(periodMs);
}
