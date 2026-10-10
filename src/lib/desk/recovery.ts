/**
 * Safe recovery of ambiguous OMS sends (stage intent/unknown: the POST may or may not have reached Kalshi).
 *
 * Evidence comes ONLY from authenticated read-only Kalshi records (kalshi-readonly.ts): the order list on the
 * ticker (matched by client_order_id), fills, position, settlements and market status. Rules:
 *  - order listed under our client_order_id      → FOUND: the exchange record is proof; journal "found" row.
 *  - any read failed / incomplete               → EVIDENCE_INCOMPLETE: stays reserved.
 *  - market still open (could still fill)       → MARKET_OPEN: stays reserved.
 *  - market closed, no order, every fill / position / settlement contract on the ticker explained by desk
 *    orders the journal knows                   → PROVEN_ABSENT: queued; release needs an operator approval.
 *  - anything unexplained                       → AMBIGUOUS: queued; release needs an operator approval + reason.
 * There is NO timeout-based release: time passing never changes a classification. Every evidence read, approval and
 * release is appended to <data>/oms-recovery-queue.jsonl (audit trail). This module never sends, cancels or amends.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { KOrder } from "./kalshi-read";
import type { KFill, KMarketStatus, KPosition, KSettlement, ReadOnlyKalshi } from "./kalshi-readonly";

export type Classification = "found" | "evidence_incomplete" | "market_open" | "proven_absent" | "ambiguous";

export type Evidence = {
  cid: string;
  ticker: string;
  readAt: string;
  errors: string[];
  order: { order_id: string; status: string; fill_count_fp?: string } | null;
  market: KMarketStatus | null;
  fills: number;
  unexplainedFills: string[];
  positionFp: number | null;
  settlement: { yes: number; no: number } | null;
  explained: { yes: number; no: number };
  classification: Classification;
  reasons: string[];
};

const CLOSED = new Set(["closed", "settled", "determined", "finalized"]);
const num = (x: unknown) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};
const sideOfFill = (f: KFill): "yes" | "no" | null => {
  const s = String(f.outcome_side ?? f.side ?? "").toLowerCase();
  return s === "yes" || s === "no" ? s : null;
};

/** Pure classification of the read-only records (unit-tested). */
export function classify(input: {
  cid: string;
  ticker: string;
  readAt: string;
  errors: string[];
  orders: KOrder[] | null;
  fills: KFill[] | null;
  position: KPosition | null | undefined;
  settlements: KSettlement[] | null;
  market: KMarketStatus | null | undefined;
  /** order ids of desk orders on this ticker the journal knows (sent/found rows) */
  knownOrderIds: Set<string>;
}): Evidence {
  const reasons: string[] = [];
  const errors = [...input.errors];
  const hit = input.orders?.find((o) => o.client_order_id === input.cid) ?? null;
  const base = {
    cid: input.cid, ticker: input.ticker, readAt: input.readAt, errors,
    order: hit ? { order_id: hit.order_id, status: hit.status, fill_count_fp: hit.fill_count_fp } : null,
    market: input.market ?? null, fills: input.fills?.length ?? 0, unexplainedFills: [] as string[],
    positionFp: null as number | null, settlement: null as { yes: number; no: number } | null, explained: { yes: 0, no: 0 },
  };
  if (hit) return { ...base, classification: "found", reasons: [`order ${hit.order_id} listed under client_order_id (${hit.status})`] };
  if (input.orders == null) errors.push("orders unread");
  if (input.fills == null) errors.push("fills unread");
  if (input.settlements == null) errors.push("settlements unread");
  if (input.position === undefined) errors.push("position unread");
  if (input.market === undefined || input.market === null) errors.push("market status unread");
  if (errors.length) return { ...base, errors, classification: "evidence_incomplete", reasons: ["reads failed: keep reserved"] };
  const market = input.market as KMarketStatus;
  if (!CLOSED.has(market.status.toLowerCase())) {
    return { ...base, classification: "market_open", reasons: [`market ${market.status}: an order could still exist/fill — keep reserved`] };
  }
  const explained = { yes: 0, no: 0 };
  const unexplained: string[] = [];
  for (const f of input.fills!) {
    const side = sideOfFill(f);
    const count = num(f.count_fp);
    // V2 single book: a desk NO buy prints as outcome_side "no" with action "sell" (verified live 2026-10-09), so the
    // contract side comes from outcome_side; only fills of desk orders the journal knows can be explained.
    if (f.order_id && input.knownOrderIds.has(f.order_id) && side && count != null) explained[side] += count;
    else unexplained.push(f.fill_id ?? f.order_id ?? "fill");
  }
  const st = input.settlements!.find((s) => s.ticker === input.ticker) ?? null;
  const settlement = st ? { yes: num(st.yes_count_fp) ?? Number.NaN, no: num(st.no_count_fp) ?? Number.NaN } : null;
  const positionFp = input.position ? num(input.position.position_fp) : 0;
  if (unexplained.length) reasons.push(`${unexplained.length} fill(s) not from a known desk order`);
  if (settlement) {
    if (!(Math.abs(settlement.yes - explained.yes) < 1e-9 && Math.abs(settlement.no - explained.no) < 1e-9)) {
      reasons.push(`settled contracts yes ${settlement.yes} / no ${settlement.no} ≠ explained ${explained.yes} / ${explained.no}`);
    }
  } else if (positionFp == null || Math.abs(positionFp - (explained.yes - explained.no)) > 1e-9) {
    reasons.push(`position ${positionFp} ≠ explained ${explained.yes - explained.no}`);
  } else if (explained.yes + explained.no > 0) {
    // a closed market with an open explained position is not settled yet: an unseen order could still settle into it
    reasons.push("closed but not settled yet");
  }
  const out = { ...base, unexplainedFills: unexplained, positionFp, settlement, explained };
  if (reasons.length) return { ...out, classification: "ambiguous", reasons };
  return { ...out, classification: "proven_absent", reasons: ["market closed; no order under this client_order_id; every fill/position/settlement explained by known desk orders"] };
}

/** Read every record for one ambiguous send (read-only). Any failed read → incomplete evidence. */
export async function gatherEvidence(k: ReadOnlyKalshi, cid: string, ticker: string, knownOrderIds: Set<string>, now = Date.now()): Promise<Evidence> {
  const errors: string[] = [];
  const safe = async <T>(name: string, f: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await f();
    } catch (e) {
      errors.push(`${name}: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
      return undefined;
    }
  };
  const [orders, fills, position, settlements, market] = await Promise.all([
    safe("orders", () => k.ordersOnTicker(ticker)),
    safe("fills", () => k.fillsOnTicker(ticker)),
    safe("position", () => k.positionOnTicker(ticker)),
    safe("settlements", () => k.settlementsOnTicker(ticker)),
    safe("market", () => k.market(ticker)),
  ]);
  return classify({
    cid, ticker, readAt: new Date(now).toISOString(), errors,
    orders: orders ?? null, fills: fills ?? null, position, settlements: settlements ?? null, market, knownOrderIds,
  });
}

export type QueueRow =
  | { ts: string; kind: "evidence"; cid: string; ticker: string; classification: Classification; evidenceId: string; reasons: string[]; errors: string[] }
  | { ts: string; kind: "approval"; cid: string; evidenceId: string; classification: Classification; by: string; reason: string; approvalId: string }
  | { ts: string; kind: "released"; cid: string; approvalId: string };

export const APPROVAL_EVIDENCE_MAX_AGE_MS = 15 * 60_000;

export function evidenceId(e: Evidence) {
  return createHash("sha256").update(JSON.stringify(e)).digest("hex").slice(0, 16);
}

/** Append-only operator-approval queue + audit trail. */
export class RecoveryQueue {
  readonly file: string;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = `${dir}/oms-recovery-queue.jsonl`;
  }
  rows(): QueueRow[] {
    if (!existsSync(this.file)) return [];
    const out: QueueRow[] = [];
    for (const l of readFileSync(this.file, "utf8").split("\n")) {
      if (!l.trim()) continue;
      try {
        out.push(JSON.parse(l) as QueueRow);
      } catch {
        /* a torn audit line is ignored; it can never approve anything */
      }
    }
    return out;
  }
  private add(r: QueueRow) {
    appendFileSync(this.file, `${JSON.stringify(r)}\n`);
    return r;
  }
  recordEvidence(e: Evidence, now = Date.now()) {
    return this.add({ ts: new Date(now).toISOString(), kind: "evidence", cid: e.cid, ticker: e.ticker, classification: e.classification, evidenceId: evidenceId(e), reasons: e.reasons, errors: e.errors });
  }
  latestEvidence(cid: string) {
    return this.rows().filter((r): r is Extract<QueueRow, { kind: "evidence" }> => r.kind === "evidence" && r.cid === cid).at(-1) ?? null;
  }
  /** Items waiting for an operator: latest evidence is proven_absent or ambiguous and no release yet. */
  pending() {
    const rel = new Set(this.rows().filter((r) => r.kind === "released").map((r) => r.cid));
    const latest = new Map<string, Extract<QueueRow, { kind: "evidence" }>>();
    for (const r of this.rows()) if (r.kind === "evidence") latest.set(r.cid, r);
    return [...latest.values()].filter((r) => !rel.has(r.cid) && (r.classification === "proven_absent" || r.classification === "ambiguous"));
  }
  /**
   * Operator approval. Only for the LATEST evidence, only if it is fresh (re-read within 15 min, so the approver
   * saw current exchange state), only for proven_absent / ambiguous, and ambiguous needs a written reason.
   */
  approve(cid: string, by: string, reason: string, now = Date.now()): { ok: true; approvalId: string } | { ok: false; why: string } {
    const ev = this.latestEvidence(cid);
    if (!ev) return { ok: false, why: "no evidence recorded for this cid" };
    if (!by.trim()) return { ok: false, why: "approver name required" };
    if (now - Date.parse(ev.ts) > APPROVAL_EVIDENCE_MAX_AGE_MS) return { ok: false, why: "evidence older than 15 min: re-run the read-only scan first" };
    if (ev.classification !== "proven_absent" && ev.classification !== "ambiguous") return { ok: false, why: `classification ${ev.classification} cannot be released` };
    if (ev.classification === "ambiguous" && reason.trim().length < 10) return { ok: false, why: "ambiguous release needs a written reason (≥10 chars)" };
    const approvalId = createHash("sha256").update(`${cid}|${ev.evidenceId}|${by}|${now}`).digest("hex").slice(0, 12);
    this.add({ ts: new Date(now).toISOString(), kind: "approval", cid, evidenceId: ev.evidenceId, classification: ev.classification, by: by.trim(), reason: reason.trim(), approvalId });
    return { ok: true, approvalId };
  }
  /** The approval that may release this cid now (must match the latest evidence). */
  approvalFor(cid: string) {
    const ev = this.latestEvidence(cid);
    if (!ev) return null;
    const a = this.rows().filter((r): r is Extract<QueueRow, { kind: "approval" }> => r.kind === "approval" && r.cid === cid && r.evidenceId === ev.evidenceId).at(-1);
    return a ?? null;
  }
  markReleased(cid: string, approvalId: string, now = Date.now()) {
    return this.add({ ts: new Date(now).toISOString(), kind: "released", cid, approvalId });
  }
}
