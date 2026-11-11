/** Injected read-only diagnostic. Correlation never establishes ownership or routing. */
import { readScopedSnapshot, type MarginAccount, type SnapshotReads } from "../../src/lib/perps/scoped-snapshot";

import type { AccountRequestEvidence, RequestList } from "../../src/lib/perps/request-evidence";

type ObjectRow = Record<string, unknown>;
const object = (x: unknown): x is ObjectRow => !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown): x is string => typeof x === "string" && x.trim() !== "";
const types = ["cross", "isolated", "auto_rebalance", "managed_isolated"] as const;
export const USAGE = "account-read.ts --subaccount <nonnegative safe integer> --subaccount-type <cross|isolated|auto_rebalance|managed_isolated> [--journal <path>]";

export function parseAccountReadArgs(args: readonly string[]) {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]!;
    const value = args[i + 1];
    if (!["--subaccount", "--subaccount-type", "--journal"].includes(key) ||
        values.has(key) || !value || value.startsWith("--")) throw new Error(USAGE);
    values.set(key, value);
  }
  const raw = values.get("--subaccount");
  const type = values.get("--subaccount-type");
  if (!raw || !/^[0-9]+$/.test(raw) || !Number.isSafeInteger(Number(raw)) ||
      !types.some((t) => t === type)) throw new Error(USAGE);
  const selection: MarginAccount = Object.freeze({ subaccount: Number(raw), subaccount_type: type as MarginAccount["subaccount_type"] });
  return { selection, journalPath: values.get("--journal") };
}

const states = new Set(["INTENT", "SENT", "ACK", "PROTECTION_FAILED", "PROTECTION_VERIFIED", "UNKNOWN", "RECONCILED", "REJECTED", "CANCELED"]);
function journalLines(input: string) {
  return input.split(/\r?\n/).map((raw, index) => {
    let value: unknown;
    let error: string | null = null;
    if (!raw.trim()) return { line: index + 1, raw, value: null, error: null, blank: true };
    try { value = JSON.parse(raw); } catch { error = "invalid JSON"; }
    if (!error && (!object(value) || !text(value.cid) || !text(value.at) ||
        typeof value.state !== "string" || !states.has(value.state))) error = "invalid journal row";
    return { line: index + 1, raw, value, error, blank: false };
  });
}

export async function runAccountRead(args: readonly string[], dependencies: {
  loadReads(): Promise<SnapshotReads>;
  readJournal(path: string): Promise<string>;
  loadRequestEvidence?(selection: MarginAccount, tickers: readonly string[]): Promise<AccountRequestEvidence>;
}) {
  // Validate before journal IO, dynamic live import, or account reads.
  const { selection, journalPath } = parseAccountReadArgs(args);
  const journal = journalPath ? journalLines(await dependencies.readJournal(journalPath)) : null;
  const snapshot = await readScopedSnapshot(await dependencies.loadReads(), selection);
  const selectedTickers = snapshot.positions.flatMap((p) => p.attribution === "reported" && p.selected &&
    typeof p.raw.market_ticker === "string" ? [p.raw.market_ticker] : []);
  const requestEvidence = dependencies.loadRequestEvidence
    ? await dependencies.loadRequestEvidence(selection, selectedTickers) : null;
  const filteredOrders = requestEvidence?.orders;
  if (requestEvidence) {
    const validateList = (list: RequestList, expectedPath: string) => {
      let valid = false;
      try {
        const url = new URL(list.request.path, snapshot.sourceOrigin);
        valid = list.sourceOrigin === snapshot.sourceOrigin && list.request.method === "GET" &&
          list.request.path === expectedPath && url.origin === snapshot.sourceOrigin &&
          url.pathname + url.search === expectedPath && !url.hash &&
          url.searchParams.getAll("subaccount").length === 1 &&
          url.searchParams.get("subaccount") === String(selection.subaccount) &&
          list.request.subaccount === selection.subaccount && Array.isArray(list.rows);
      } catch { /* Malformed injected envelopes fail closed. */ }
      if (!valid) throw new Error("request evidence mismatch");
    };
    validateList(requestEvidence.orders, `/trade-api/v2/margin/orders?limit=1000&subaccount=${selection.subaccount}`);
    validateList(requestEvidence.fills, `/trade-api/v2/margin/fills?limit=1000&subaccount=${selection.subaccount}`);
    const expectedTriggers = new Set(selection.subaccount_type === "cross" ? selectedTickers.map((ticker) =>
      `/trade-api/v2/margin/cross/positions/${encodeURIComponent(ticker)}/exit_trigger?subaccount=${selection.subaccount}`) : []);
    if (!Array.isArray(requestEvidence.crossTriggers) || requestEvidence.crossTriggers.length !== expectedTriggers.size) {
      throw new Error("request evidence mismatch");
    }
    for (const list of requestEvidence.crossTriggers) {
      const path = list?.request?.path;
      if (!expectedTriggers.delete(path)) throw new Error("request evidence mismatch");
      validateList(list, path);
    }
  }
  const consistentRow = (raw: ObjectRow) =>
    (!Object.hasOwn(raw, "subaccount") || raw.subaccount === selection.subaccount) &&
    (!Object.hasOwn(raw, "subaccount_number") || raw.subaccount_number === selection.subaccount) &&
    (!Object.hasOwn(raw, "subaccount_type") || raw.subaccount_type === selection.subaccount_type);
  const immutableIdentityMatches = (original: ObjectRow, filtered: ObjectRow) => {
    if (!text(original.client_order_id) || original.client_order_id !== filtered.client_order_id ||
        !text(original.ticker) || !text(filtered.ticker) || original.ticker !== filtered.ticker) return false;
    for (const row of [original, filtered]) {
      if (Object.hasOwn(row, "user_id") && !text(row.user_id)) return false;
      if (Object.hasOwn(row, "side") && row.side !== "bid" && row.side !== "ask") return false;
    }
    return (!Object.hasOwn(original, "user_id") || !Object.hasOwn(filtered, "user_id") || original.user_id === filtered.user_id) &&
      (!Object.hasOwn(original, "side") || !Object.hasOwn(filtered, "side") || original.side === filtered.side);
  };
  const intendedEvidence = (value: unknown) => {
    if (!object(value)) return "unverified";
    if (!Object.hasOwn(value, "intendedRouting") && !Object.hasOwn(value, "serializedRequest")) return "unverified";
    const route = value.intendedRouting;
    if (!object(route) || route.origin !== snapshot.sourceOrigin || route.subaccount !== selection.subaccount ||
        route.subaccount_type !== selection.subaccount_type) return "conflicting";
    if (!Object.hasOwn(value, "serializedRequest")) return "intended-only";
    const request = value.serializedRequest;
    if (!object(request) || request.url !== snapshot.sourceOrigin + "/trade-api/v2/margin/orders" ||
        request.method !== "POST" || typeof request.body !== "string") return "conflicting";
    try {
      const body: unknown = JSON.parse(request.body);
      return object(body) && body.subaccount === selection.subaccount && body.client_order_id === value.cid &&
        text(body.ticker) && (!object(value.intent) || body.ticker === value.intent.ticker) ? "serialized-intent" : "conflicting";
    } catch { return "conflicting"; }
  };
  const matchedLines = new Set<number>();
  function correlate(record: typeof snapshot.orders[number], requestFiltered = false) {
    const raw = record.raw;
    let correlation: "exact-order-id-and-cid" | "unresolved" = "unresolved";
    let reason = journal ? "unmatched or ambiguous identity" : "journal not supplied";
    if (journal && !journal.some((line) => line.error) && raw.order_source === "user" && ((record.attribution === "reported" && record.selected) || requestFiltered) &&
        (!requestFiltered || (raw.order_source === "user" && consistentRow(raw) &&
          filteredOrders!.rows.filter((r) => object(r) && r.order_id === raw.order_id).length === 1 &&
          filteredOrders!.rows.filter((r) => object(r) && r.client_order_id === raw.client_order_id).length === 1 &&
          snapshot.orders.filter((r) => r.raw.order_id === raw.order_id).every((r) => consistentRow(r.raw) && r.raw.order_source === "user" && immutableIdentityMatches(r.raw, raw)))) && text(raw.order_id) && text(raw.client_order_id) && text(raw.ticker) &&
        snapshot.orders.filter((r) => r.raw.order_id === raw.order_id).length === 1 &&
        snapshot.orders.filter((r) => r.raw.client_order_id === raw.client_order_id).length === 1) {
      const candidates = journal.filter((line) => !line.error && object(line.value) && line.value.order_id === raw.order_id);
      const cidRows = journal.filter((line) => !line.error && object(line.value) && line.value.cid === raw.client_order_id);
      const consistent = (value: unknown) => {
        if (!object(value) || intendedEvidence(value) === "conflicting") return false;
        if (object(value.serializedRequest)) {
          try { if (JSON.parse(String(value.serializedRequest.body)).ticker !== raw.ticker) return false; }
          catch { return false; }
        }
        if (value.order_id != null && value.order_id !== raw.order_id) return false;
        if ((Object.hasOwn(value, "subaccount") && value.subaccount !== selection.subaccount) ||
            (Object.hasOwn(value, "subaccount_type") && value.subaccount_type !== selection.subaccount_type) ||
            (Object.hasOwn(value, "sourceOrigin") && value.sourceOrigin !== snapshot.sourceOrigin)) return false;
        if (!Object.hasOwn(value, "scope")) return true; // legacy correlation, NOT ownership
        const scope = value.scope;
        return object(scope) && scope.sourceOrigin === snapshot.sourceOrigin &&
          scope.subaccount === selection.subaccount && scope.subaccount_type === selection.subaccount_type;
      };
      if (candidates.length > 0 && candidates.every((line) => object(line.value) &&
          line.value.cid === raw.client_order_id && consistent(line.value)) && cidRows.every((line) => consistent(line.value))) {
        correlation = "exact-order-id-and-cid";
        reason = "log correlation only; routing and ownership unverified";
        for (const line of candidates) matchedLines.add(line.line);
      }
    }
    return { record, correlation, reason, ownership: "unowned" as const };
  }
  const orders = snapshot.orders.map((record) => correlate(record));
  const requestScopedOrders = filteredOrders?.rows.map((raw) => object(raw)
    ? correlate({ raw: raw as typeof snapshot.orders[number]["raw"], attribution: "unowned", selected: false }, true)
    : { raw, correlation: "unresolved" as const, reason: "invalid order row", ownership: "unowned" as const }) ?? [];
  return {
    orderWrites: false, depositActions: false, routingVerified: false, lifecycleReady: false,
    credentialScope: "unverified" as const,
    snapshot,
    inventory: {
      selected: snapshot.positions.filter((p) => p.attribution === "reported" && p.selected),
      other: snapshot.positions.filter((p) => p.attribution === "reported" && !p.selected),
      unowned: snapshot.positions.filter((p) => p.attribution === "unowned"),
    },
    orders, requestScopedOrders, requestEvidence,
    journal: journal?.map((line) => ({ ...line, intendedRoutingEvidence: intendedEvidence(line.value), correlated: matchedLines.has(line.line), ownership: "unowned" as const })) ?? null,
    journalIntegrity: journal === null ? "not supplied" : journal.some((line) => line.error) ? "invalid lines preserved" : "parsed",
    completeness: "Non-atomic observations within successful reader filters; not certified lifecycle history, routing, ownership, or authoritative risk.",
  };
}
