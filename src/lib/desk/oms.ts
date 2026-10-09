/**
 * OMS — the ONLY code path that can send an order to Kalshi.
 *  1. risk.check(intent, snapshot)  (refusal = no POST, ever)
 *  2. deterministic client_order_id "mm1-<ticker>-<y|n>-<seq>" persisted to the journal BEFORE the POST
 *  3. one POST to one host; on timeout/network error we never re-send — we look the order up by client_order_id
 * Cancels (risk-reducing) are allowed without a risk check.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { KALSHI_HOST, kalshiDelete, kalshiSignedHeaders } from "@/lib/scan/kalshi-auth";
import { eventCancelPath } from "@/lib/scan/kalshi-order-status";
import { CALIBRATED_MODEL_APPROVED, ORDER_SHARD, TICKER_RE, dataDir } from "./config";
import { ordersByClientIds, type KOrder } from "./kalshi-read";
import type { AccountSnapshot, OrderIntent, RiskEngine } from "./risk";

export const ORDER_PATH = "/trade-api/v2/portfolio/events/orders";

export type JournalRow = {
  ts: string;
  cid: string;
  stage: "intent" | "sent" | "unknown" | "found" | "not_found" | "rejected" | "refused" | "cancel";
  ticker: string;
  side?: string;
  mode?: string;
  price?: number;
  count?: number;
  worst?: number;
  orderId?: string;
  status?: string;
  fill?: number;
  note?: string;
};

export type PostResult = { status: number; body: Record<string, unknown>; text: string };
export type Transport = (path: string, body: Record<string, unknown>) => Promise<PostResult>;
export type Lookup = (cids: string[]) => Promise<KOrder[]>;

/** Real transport: signed single-host POST (no host fallback — a fallback could double-send). */
export const kalshiOrderPost: Transport = async (path, body) => {
  const res = await fetch(`${KALSHI_HOST}${path}`, {
    method: "POST",
    headers: kalshiSignedHeaders("POST", path),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  });
  const text = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* raw */
  }
  return { status: res.status, body: parsed, text: text.slice(0, 400) };
};

export function cidFor(ticker: string, side: "yes" | "no", seq: number) {
  return `mm1-${ticker}-${side === "yes" ? "y" : "n"}-${seq}`;
}

/** V2 single-book: buy YES = bid at p; buy NO at q = ask (sell YES) at 1 − q. */
export function orderBody(intent: OrderIntent, cid: string) {
  const yesPrice = intent.side === "yes" ? intent.price : 1 - intent.price;
  return {
    ticker: intent.ticker,
    client_order_id: cid,
    side: intent.side === "yes" ? "bid" : "ask",
    count: intent.count.toFixed(2),
    price: yesPrice.toFixed(4),
    time_in_force: intent.mode === "maker" ? "good_till_canceled" : "immediate_or_cancel",
    post_only: intent.mode === "maker",
    self_trade_prevention_type: "taker_at_cross",
    cancel_order_on_pause: true,
    exchange_index: ORDER_SHARD,
  } as Record<string, unknown>;
}

export type Canceller = (path: string) => Promise<{ status: number }>;
export type OmsTestHooks = {
  /**
   * Test harness only: stands in for CALIBRATED_MODEL_APPROVED so mocked-exchange scenarios can drive the send
   * path. Refused at construction unless BOTH the transport and the canceller are mocks — the real signed
   * Kalshi transport is always gated by the config constant.
   */
  releaseGateForMockOnly?: () => boolean;
  canceller?: Canceller;
  reconcileWaitMs?: number;
};

export class Oms {
  private file: string;
  private gate: () => boolean;
  private del: Canceller | undefined;
  private waitMs: number;
  constructor(
    private risk: RiskEngine,
    private transport: Transport = kalshiOrderPost,
    private lookup: Lookup = ordersByClientIds,
    dir = dataDir(),
    hooks: OmsTestHooks = {},
  ) {
    mkdirSync(dir, { recursive: true });
    this.file = `${dir}/oms-journal.jsonl`;
    if (hooks.releaseGateForMockOnly && (transport === kalshiOrderPost || !hooks.canceller || hooks.canceller === kalshiDelete)) {
      throw new Error("release-gate override is only allowed with a mock transport and a mock canceller");
    }
    this.gate = hooks.releaseGateForMockOnly ?? (() => CALIBRATED_MODEL_APPROVED);
    this.del = hooks.canceller;
    this.waitMs = hooks.reconcileWaitMs ?? 700;
  }

  /** Rows that could not be read on the last journal pass (bad JSON, missing fields, unknown risk). */
  corruptRows = 0;

  /**
   * Readable journal rows. A corrupt row never throws into the engine loop (review B5): it is skipped and
   * counted, and `submit` refuses every new order while any corrupt row exists (fail closed). Cancels and
   * reconciliation of the readable rows keep working.
   */
  journal(): JournalRow[] {
    if (!existsSync(this.file)) {
      this.corruptRows = 0;
      return [];
    }
    let bad = 0;
    const rows: JournalRow[] = [];
    for (const l of readFileSync(this.file, "utf8").split("\n")) {
      if (!l.trim()) continue;
      try {
        const r = JSON.parse(l) as JournalRow;
        if (!r || typeof r !== "object" || typeof r.cid !== "string" || typeof r.stage !== "string" || typeof r.ticker !== "string") {
          bad += 1;
          continue;
        }
        if (r.stage === "intent" && !(Number.isFinite(r.worst) && (r.worst as number) > 0)) {
          bad += 1; // an intent whose risk is unknown cannot be reserved correctly
          continue;
        }
        rows.push(r);
      } catch {
        bad += 1;
      }
    }
    this.corruptRows = bad;
    return rows;
  }

  private write(row: Omit<JournalRow, "ts">) {
    appendFileSync(this.file, `${JSON.stringify({ ts: new Date().toISOString(), ...row })}\n`);
  }

  /** Orders this desk has attempted per ticker (every persisted intent counts, sent or not). */
  perTicker(): Record<string, number> {
    const out: Record<string, number> = {};
    const seen = new Set<string>();
    for (const r of this.journal()) {
      if (r.stage !== "intent" || seen.has(r.cid)) continue;
      seen.add(r.cid);
      out[r.ticker] = (out[r.ticker] ?? 0) + 1;
    }
    return out;
  }

  /**
   * Every send whose outcome is still ambiguous (last journal stage intent/unknown), at any age. The snapshot counts its
   * worst case only while Kalshi does not list the client_order_id; once acknowledged, Kalshi's own numbers count.
   */
  pendingIntents(_now = Date.now()): Array<{ cid: string; ticker: string; worst: number }> {
    const last = new Map<string, JournalRow>();
    const intent = new Map<string, JournalRow>();
    for (const r of this.journal()) {
      last.set(r.cid, r);
      if (r.stage === "intent") intent.set(r.cid, r);
    }
    const out: Array<{ cid: string; ticker: string; worst: number }> = [];
    for (const [cid, i] of intent) {
      const st = last.get(cid)?.stage;
      // Only a send whose outcome is still ambiguous (no order id ever seen) is pending risk.
      // Once Kalshi acknowledged it (sent/found) or it was cancelled, Kalshi's own resting/position/fill
      // records carry its exposure; counting it here as well would add it forever, across ET days (review B1).
      if (st !== "intent" && st !== "unknown") continue;
      // A network-ambiguous order never ages out of risk simply because the clock advanced.
      out.push({ cid, ticker: i.ticker, worst: i.worst ?? 0 });
    }
    return out;
  }

  /** Worst case of every send that might be live, ignoring what Kalshi already shows (upper bound, used in tests/status). */
  pendingWorst(now = Date.now()): number {
    return this.pendingIntents(now).reduce((a, x) => a + x.worst, 0);
  }

  /** Tickers with an order sent in the last `ms` (Kalshi's resting list can lag a fresh post). */
  recentTickers(now = Date.now(), ms = 20_000): Set<string> {
    const out = new Set<string>();
    for (const r of this.journal()) if (r.stage === "intent" && now - Date.parse(r.ts) < ms) out.add(r.ticker);
    return out;
  }

  nextSeq(ticker: string, side: "yes" | "no") {
    const pre = `mm1-${ticker}-${side === "yes" ? "y" : "n"}-`;
    let max = 0;
    for (const r of this.journal()) if (r.cid.startsWith(pre)) max = Math.max(max, Number(r.cid.slice(pre.length)) || 0);
    return max + 1;
  }

  /** The single choke point. */
  async submit(intent: OrderIntent, snapshot: AccountSnapshot | null): Promise<{ ok: boolean; why: string; cid?: string; orderId?: string; status?: string; fill?: number }> {
    this.journal();
    if (this.corruptRows > 0) return { ok: false, why: `OMS journal has ${this.corruptRows} unreadable row(s): sending disabled until reconciled` };
    if (!this.gate()) return { ok: false, why: "model not independently calibrated / production release disabled" };
    if (!TICKER_RE.test(intent.ticker)) return { ok: false, why: "ticker" };
    // limit orders only: an explicit price strictly inside (0,1) and a whole contract count, every time
    if (!(intent.price > 0 && intent.price < 1) || !Number.isInteger(intent.count) || intent.count < 1) return { ok: false, why: "limit price / whole count required" };
    const verdict = this.risk.check(intent, snapshot);
    if (!verdict.ok) return { ok: false, why: `risk: ${verdict.why}` };
    const cid = cidFor(intent.ticker, intent.side, this.nextSeq(intent.ticker, intent.side));
    this.risk.consume(intent);
    // persist BEFORE send
    this.write({ cid, stage: "intent", ticker: intent.ticker, side: intent.side, mode: intent.mode, price: intent.price, count: intent.count, worst: verdict.orderWorst });
    let res: PostResult;
    try {
      res = await this.transport(ORDER_PATH, orderBody(intent, cid));
    } catch (e) {
      this.write({ cid, stage: "unknown", ticker: intent.ticker, note: e instanceof Error ? e.message.slice(0, 160) : "network" });
      const found = await this.reconcileOne(cid, intent.ticker);
      return found ? { ok: true, why: "reconciled after timeout", cid, orderId: found.order_id, status: found.status, fill: Number(found.fill_count_fp ?? 0) } : { ok: false, why: "send outcome unknown (not re-sent)", cid };
    }
    if (res.status === 200 || res.status === 201) {
      const orderId = String(res.body.order_id ?? "");
      const fill = Number(res.body.fill_count ?? 0);
      const remaining = Number(res.body.remaining_count ?? 0);
      const status = intent.mode === "taker" ? (fill > 0 ? "executed" : "canceled") : remaining > 0 ? "resting" : fill > 0 ? "executed" : "canceled";
      this.write({ cid, stage: "sent", ticker: intent.ticker, orderId, status, fill });
      return { ok: true, why: "sent", cid, orderId, status, fill };
    }
    if (res.status >= 500 || res.status === 0 || res.status === 429) {
      this.write({ cid, stage: "unknown", ticker: intent.ticker, note: `http ${res.status} ${res.text.slice(0, 120)}` });
      const found = await this.reconcileOne(cid, intent.ticker);
      return found ? { ok: true, why: "reconciled", cid, orderId: found.order_id, status: found.status } : { ok: false, why: `http ${res.status}; not found (not re-sent)`, cid };
    }
    this.write({ cid, stage: "rejected", ticker: intent.ticker, note: `http ${res.status} ${res.text.slice(0, 200)}` });
    return { ok: false, why: `rejected ${res.status} ${res.text.slice(0, 160)}`, cid };
  }

  /** Look an order up by client_order_id (never re-sends). */
  async reconcileOne(cid: string, ticker: string, tries = 3, waitMs = this.waitMs): Promise<KOrder | null> {
    for (let i = 0; i < tries; i += 1) {
      try {
        const hit = (await this.lookup([cid])).find((o) => o.client_order_id === cid);
        if (hit) {
          this.write({ cid, stage: "found", ticker, orderId: hit.order_id, status: hit.status, fill: Number(hit.fill_count_fp ?? 0) });
          return hit;
        }
      } catch {
        /* try again */
      }
      if (i < tries - 1) await new Promise((r) => setTimeout(r, waitMs));
    }
    return null;
  }

  /** On boot and every tick: look every intent/unknown row up on Kalshi by client_order_id. Absent rows stay pending (never auto not_found). */
  async reconcilePending(_now = Date.now()) {
    const last = new Map<string, JournalRow>();
    for (const r of this.journal()) last.set(r.cid, r);
    const open = [...last.values()].filter((r) => r.stage === "intent" || r.stage === "unknown");
    if (!open.length) return 0;
    let hits: KOrder[] = [];
    try {
      hits = await this.lookup(open.map((r) => r.cid));
    } catch {
      return open.length;
    }
    for (const r of open) {
      const h = hits.find((o) => o.client_order_id === r.cid);
      if (h) this.write({ cid: r.cid, stage: "found", ticker: r.ticker, orderId: h.order_id, status: h.status, fill: Number(h.fill_count_fp ?? 0) });
      // Not observed is NOT authoritative proof an order was never filled.
      // Preserve pending risk until fill/order/account history conclusively reconciles it.
    }
    return open.length;
  }

  async cancel(orderId: string, ticker: string, cid: string, why: string) {
    // the real path is always the signed event-order DELETE; only a constructor-validated mock replaces it
    const r = this.del ? await this.del(eventCancelPath(orderId, ticker)) : await kalshiDelete(eventCancelPath(orderId, ticker));
    this.write({ cid, stage: "cancel", ticker, orderId, note: `${why} · http ${r.status}` });
    return r.status;
  }
}
