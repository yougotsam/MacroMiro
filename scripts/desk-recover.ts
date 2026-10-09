/**
 * Read-only recovery of ambiguous OMS sends (see src/lib/desk/recovery.ts).
 *   bun scripts/desk-recover.ts scan                     read Kalshi (GET only), classify every ambiguous send, queue evidence
 *   bun scripts/desk-recover.ts evidence <cid>           read + classify one cid, print, write nothing
 *   bun scripts/desk-recover.ts list                     operator queue (proven_absent / ambiguous, not released)
 *   bun scripts/desk-recover.ts approve <cid> --by NAME --reason "TEXT"   operator release (needs fresh evidence)
 * Never sends, cancels or amends: the OMS here has throwing transport/canceller and the process fetch is GET-only.
 * Never prints keys or signatures.
 */
import { dataDir } from "@/lib/desk/config";
import { installReadOnlyFetch } from "@/lib/desk/net-guard";
import { recoveryOms } from "@/lib/desk/oms";
import { tickerOfCid } from "@/lib/desk/kalshi-read";
import { readOnlyKalshi } from "@/lib/desk/kalshi-readonly";
import { RecoveryQueue, gatherEvidence } from "@/lib/desk/recovery";
import { RiskEngine } from "@/lib/desk/risk";

const guard = installReadOnlyFetch();
const OFF = { live: () => false, begin: () => false, arm: () => false };
const dir = dataDir();
const oms = recoveryOms(new RiskEngine(dir, OFF), dir);
const queue = new RecoveryQueue(dir);
const k = readOnlyKalshi();
const [cmd, ...rest] = process.argv.slice(2);
const arg = (name: string) => {
  const i = rest.indexOf(name);
  return i >= 0 ? (rest[i + 1] ?? "") : "";
};
const show = (e: Awaited<ReturnType<typeof gatherEvidence>>) =>
  console.log(JSON.stringify({ cid: e.cid, ticker: e.ticker, classification: e.classification, reasons: e.reasons, errors: e.errors, order: e.order, market: e.market, fills: e.fills, unexplainedFills: e.unexplainedFills.length, positionFp: e.positionFp, settlement: e.settlement, explained: e.explained }));

if (cmd === "scan") {
  const pend = oms.pendingIntents();
  console.log(`ambiguous sends in journal: ${pend.length}${oms.corruptRows ? ` (corrupt rows: ${oms.corruptRows})` : ""}`);
  for (const p of pend) {
    const e = await gatherEvidence(k, p.cid, p.ticker, oms.knownOrderIds(p.ticker));
    queue.recordEvidence(e);
    if (e.classification === "found") oms.recordFound(e);
    show(e);
  }
  console.log(`operator queue: ${queue.pending().length}; network GET ${guard.allowed}, refused ${guard.refused}`);
} else if (cmd === "evidence") {
  const cid = rest[0] ?? "";
  const ticker = tickerOfCid(cid);
  if (!ticker) throw new Error("not a desk client_order_id");
  show(await gatherEvidence(k, cid, ticker, oms.knownOrderIds(ticker)));
  console.log(`network GET ${guard.allowed}, refused ${guard.refused} (nothing written)`);
} else if (cmd === "list") {
  for (const r of queue.pending()) console.log(JSON.stringify(r));
  console.log(`${queue.pending().length} waiting for an operator`);
} else if (cmd === "approve") {
  const cid = rest[0] ?? "";
  const a = queue.approve(cid, arg("--by"), arg("--reason"));
  if (!a.ok) {
    console.log(`refused: ${a.why}`);
    process.exit(1);
  }
  console.log(JSON.stringify(oms.releaseApproved(cid, queue)));
} else {
  console.log("usage: scan | evidence <cid> | list | approve <cid> --by NAME --reason TEXT");
  process.exit(2);
}
