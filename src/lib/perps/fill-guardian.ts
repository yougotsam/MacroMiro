/**
 * Durable perps protective-exit reconciliation, independent of the UI.
 * Run against the same persistent OMS journal as the entry engine.
 * No entry is sent by this module. A verified OPEN venue position requires
 * an exchange-confirmed stop/target; orphaned exposure permanently latches
 * the entry gate until reviewed.
 */
import type { Intent, JournalRow, PerpsTransport, PerpsOms } from "./oms";

type Entry = { cid: string; intent: Intent; orderId: string };
export type GuardianResult = {
  status: "OK" | "INCIDENT";
  openPositions: number;
  verified: number;
  failures: string[];
};

export function knownEntryOrders(rows: JournalRow[]): Entry[] {
  const state = new Map<string, { intent?: Intent; orderId?: string; last?: string }>();
  for (const row of rows) {
    const a = state.get(row.cid) ?? {};
    if (row.intent) a.intent = row.intent;
    if (row.order_id) a.orderId = row.order_id;
    a.last = row.state;
    state.set(row.cid, a);
  }
  return [...state].flatMap(([cid, a]) => a.intent?.kind === "entry" && a.intent.plan &&
    a.orderId && a.last !== "REJECTED"
      ? [{ cid, intent: a.intent, orderId: a.orderId }]
      : []);
}

export async function reconcileFilledProtection(oms: PerpsOms, venue: PerpsTransport): Promise<GuardianResult> {
  // Read actual exchange state each pass, never infer a fill from a placed order.
  const [positions, fills] = await Promise.all([venue.positions(), venue.fills({})]);
  const entries = knownEntryOrders(oms.rows);
  const failures: string[] = [];
  let openPositions = 0, verified = 0;
  for (const position of positions) {
    const qty = Number(position.position);
    if (!Number.isFinite(qty)) {
      const why = `invalid venue position ${position.market_ticker}`;
      oms.latchProtectionFault(why); failures.push(why); continue;
    }
    if (qty === 0) continue;
    openPositions++;
    const matching = entries.filter(e => e.intent.ticker === position.market_ticker &&
      fills.some(f => f.order_id === e.orderId && f.ticker === e.intent.ticker && Number(f.count) > 0));
    // A canceled remainder can still leave a partially filled open position.
    if (matching.length !== 1) {
      const why = `unmanaged or ambiguous filled position on ${position.market_ticker} (matched ${matching.length} orders)`;
      oms.latchProtectionFault(why); failures.push(why); continue;
    }
    const result = await oms.ensureAfterFill(matching[0].intent, matching[0].orderId);
    if (result.state !== "PROTECTION_VERIFIED") failures.push(`${position.market_ticker}: ${result.state} ${result.why}`);
    else verified++;
  }
  return { status: failures.length ? "INCIDENT" : "OK", openPositions, verified, failures };
}
