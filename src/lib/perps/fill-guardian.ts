/**
 * Durable perps protective-exit reconciliation, independent of the UI.
 * Run against the same persistent OMS journal as the entry engine.
 * No entry is sent by this module. A verified OPEN venue position requires
 * an exchange-confirmed stop/target; orphaned exposure permanently latches
 * the entry gate until reviewed.
 */
import type { Intent, JournalRow, PerpsTransport, PerpsOms, VenueFill, VenuePosition } from "./oms";
import { clientOrderId, toCreateReq } from "./oms";
import { scopedUnits } from "./cross-account";
import { beatPerpsWorker, PerpsSubmissionBarrier, reportPerpsIncident } from "./emergency-control";

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

export async function reconcileFilledProtection(oms: PerpsOms, venue: PerpsTransport, snapshot?: [VenuePosition[], VenueFill[]]): Promise<GuardianResult> {
  // Read actual exchange state each pass, never infer a fill from a placed order.
  const [positions, fills] = snapshot ?? await Promise.all([venue.positions(), venue.fills({})]);
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
    const result = await oms.ensureAfterFill(matching[0].intent, matching[0].orderId, position.position);
    if (result.state !== "PROTECTION_VERIFIED") failures.push(`${position.market_ticker}: ${result.state} ${result.why}`);
    else verified++;
  }
  return { status: failures.length ? "INCIDENT" : "OK", openPositions, verified, failures };
}

/** Dedicated legacy desk only. Every signed fill must belong to a journaled
 * order. Compare its exact net contracts against the complete venue inventory,
 * including tickers absent from either side. Ambiguity halts the desk. */
export async function reconcilePerpsCycle(oms: PerpsOms, venue: PerpsTransport, journal: string): Promise<Omit<GuardianResult, "openPositions"> & { openPositions: number | null }> {
  const barrier = new PerpsSubmissionBarrier(journal);
  try {
    if (barrier.latched || oms.blocked) throw new Error(oms.blocked ?? "emergency stop latched");
    const { orders, missing, unknownVenueOrders } = await oms.reconcile(0);
    if (missing.length || unknownVenueOrders.length) throw new Error("unresolved or unowned venue orders");
    const [positions, fills] = await Promise.all([venue.positions(), venue.fills({})]);
    const intents = new Map(oms.rows.filter(r => r.state === "INTENT" && r.intent).map(r => [r.cid, r.intent!]));
    const byId = new Map(orders.map(o => [o.order_id, o]));
    const acknowledged = new Map<string, string>();
    for (const r of oms.rows) {
      if (r.order_id && byId.get(r.order_id)?.client_order_id !== r.cid) throw new Error("journal order missing or mismatched at venue");
      if (r.order_id && (r.state === "ACK" || r.state === "RECONCILED")) acknowledged.set(r.order_id, r.cid);
    }
    const filled = new Map<string, bigint>(), net = new Map<string, bigint>();
    const fillIds = new Set<string>();
    for (const f of fills) {
      const order = byId.get(f.order_id);
      if (!order || order.ticker !== f.ticker || order.side !== f.side || !f.fill_id || fillIds.has(f.fill_id)) throw new Error("unmatched or duplicate fill");
      fillIds.add(f.fill_id);
      const qty = scopedUnits(f.count, 2);
      if (qty <= 0n) throw new Error("invalid fill quantity");
      filled.set(f.order_id, (filled.get(f.order_id) ?? 0n) + qty);
      net.set(f.ticker, (net.get(f.ticker) ?? 0n) + (f.side === "bid" ? qty : -qty));
    }
    const clientIds = new Set<string>();
    for (const o of orders) {
      const i = intents.get(o.client_order_id);
      if (!i || acknowledged.get(o.order_id) !== o.client_order_id || clientOrderId(i) !== o.client_order_id || i.ticker !== o.ticker || toCreateReq(i).side !== o.side ||
          clientIds.has(o.client_order_id) || scopedUnits(o.price, 6) !== scopedUnits(toCreateReq(i).price, 6) ||
          scopedUnits(o.fill_count, 2) !== (filled.get(o.order_id) ?? 0n) ||
          scopedUnits(o.fill_count, 2) + scopedUnits(o.remaining_count, 2) > scopedUnits(String(i.qty), 2)) throw new Error("journal, order and fill evidence disagree");
      clientIds.add(o.client_order_id);
    }
    const seen = new Set<string>();
    for (const p of positions) {
      if (!p.market_ticker || seen.has(p.market_ticker) || scopedUnits(p.position, 2) !== (net.get(p.market_ticker) ?? 0n)) {
        throw new Error("venue position differs from owned fills: " + p.market_ticker);
      }
      seen.add(p.market_ticker);
      net.delete(p.market_ticker);
    }
    if ([...net.values()].some(q => q !== 0n)) throw new Error("owned fills imply a position missing from venue");
    const result = await reconcileFilledProtection(oms, venue, [positions, fills]);
    if (result.status !== "OK") throw new Error(result.failures.join(", "));
    if (barrier.latched) throw new Error("kill during reconciliation");
    beatPerpsWorker(journal);
    return result;
  } catch (e) {
    const why = String((e as Error).message).slice(0, 200);
    barrier.latch("RECONCILIATION_FAILED");
    oms.blocked = "KILL: " + why;
    reportPerpsIncident(journal, "RECONCILIATION_FAILED");
    return { status: "INCIDENT", verified: 0, openPositions: null, failures: [why] };
  }
}
