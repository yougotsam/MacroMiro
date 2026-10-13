import { describe, expect, it } from "bun:test";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOnlyKalshi, readOnlyPathAllowed } from "./kalshi-readonly";
import { installReadOnlyFetch } from "./net-guard";
import { cidFor, recoveryOms } from "./oms";
import { RecoveryQueue, classify, gatherEvidence } from "./recovery";
import { RiskEngine } from "./risk";
import type { KOrder } from "./kalshi-read";

const T = "KXBTC15M-26OCT081200-00";
const CID = cidFor(T, "no", 2);
const tmp = () => mkdtempSync(join(tmpdir(), "recov-"));
const closed = { status: "finalized", result: "no", closeMs: 1 };
const base = {
  cid: CID, ticker: T, readAt: "2026-10-09T12:00:00Z", errors: [] as string[], orders: [] as KOrder[], fills: [], position: null,
  settlements: [], market: closed, knownOrderIds: new Set(["oid-1"]),
};

describe("read-only recovery: classification", () => {
  it("an order listed under our client_order_id is FOUND (exchange record)", () => {
    const e = classify({ ...base, orders: [{ order_id: "x", client_order_id: CID, ticker: T, status: "executed", fill_count_fp: "1.00" }] });
    expect(e.classification).toBe("found");
  });
  it("any failed read keeps it reserved (evidence_incomplete)", () => {
    expect(classify({ ...base, errors: ["fills: 500"], fills: null as never }).classification).toBe("evidence_incomplete");
    expect(classify({ ...base, position: undefined }).classification).toBe("evidence_incomplete");
    expect(classify({ ...base, market: null }).classification).toBe("evidence_incomplete");
  });
  it("an open market keeps it reserved — however much time passed", () => {
    expect(classify({ ...base, market: { status: "active", result: "", closeMs: 1 } }).classification).toBe("market_open");
  });
  it("closed market, no order, all contracts explained by known desk orders → proven_absent (V2 NO fill prints as action sell)", () => {
    const e = classify({ ...base, fills: [{ fill_id: "f1", order_id: "oid-1", outcome_side: "no", action: "sell", count_fp: "1.00" }] as never, settlements: [{ ticker: T, yes_count_fp: "0", no_count_fp: "1.00" }] });
    expect(e.classification).toBe("proven_absent");
  });
  it("an unexplained fill or settled contract → ambiguous", () => {
    const fill = { fill_id: "f9", order_id: "who", outcome_side: "no", count_fp: "1.00" };
    expect(classify({ ...base, fills: [fill] as never, settlements: [{ ticker: T, yes_count_fp: "0", no_count_fp: "1" }] }).classification).toBe("ambiguous");
    expect(classify({ ...base, settlements: [{ ticker: T, yes_count_fp: "2", no_count_fp: "0" }] }).classification).toBe("ambiguous");
    expect(classify({ ...base, position: { ticker: T, position_fp: "-3" } }).classification).toBe("ambiguous");
  });
  it("gatherEvidence turns a thrown read into incomplete evidence", async () => {
    const k = { ...readOnlyKalshi(async () => ({}) as never), fillsOnTicker: async () => { throw new Error("boom"); } };
    const e = await gatherEvidence(k, CID, T, new Set());
    expect(e.classification).toBe("evidence_incomplete");
  });
});

describe("operator-approval queue: no timeout release", () => {
  const setup = () => {
    const dir = tmp();
    const off = { live: () => false, begin: () => false, arm: () => false };
    const oms = recoveryOms(new RiskEngine(dir, off), dir);
    appendFileSync(join(dir, "oms-journal.jsonl"), `${JSON.stringify({ ts: "2026-10-01T00:00:00Z", cid: CID, stage: "intent", ticker: T, worst: 1.2 })}\n${JSON.stringify({ ts: "2026-10-01T00:00:01Z", cid: CID, stage: "unknown", ticker: T })}\n`);
    return { dir, oms, q: new RecoveryQueue(dir) };
  };
  it("a send stays reserved forever without an approval, even years later", () => {
    const { oms } = setup();
    expect(oms.pendingIntents(Date.now() + 5 * 365 * 86_400_000).map((p) => p.cid)).toEqual([CID]);
  });
  it("approval needs fresh evidence of the right class, a name, and a reason for ambiguous", () => {
    const { oms, q } = setup();
    const now = Date.now();
    expect(q.approve(CID, "sam", "x", now).ok).toBe(false); // no evidence
    q.recordEvidence(classify({ ...base, market: { status: "active", result: "", closeMs: 1 } }), now);
    expect(q.approve(CID, "sam", "x", now)).toEqual({ ok: false, why: "classification market_open cannot be released" });
    q.recordEvidence(classify({ ...base, settlements: [{ ticker: T, yes_count_fp: "2", no_count_fp: "0" }] }), now);
    expect(q.approve(CID, "sam", "short", now).ok).toBe(false);
    expect(q.approve(CID, "", "a long enough reason", now).ok).toBe(false);
    expect(q.approve(CID, "sam", "a long enough reason", now + 16 * 60_000).ok).toBe(false); // stale evidence
    expect(oms.releaseApproved(CID, q).ok).toBe(false);
    expect(oms.isAmbiguous(CID)).toBe(true);
  });
  it("released only with an approval bound to the latest evidence; audit trail in journal and queue", () => {
    const { dir, oms, q } = setup();
    const now = Date.now();
    q.recordEvidence(classify({ ...base }), now);
    const a = q.approve(CID, "sam", "", now);
    expect(a.ok).toBe(true);
    // newer evidence invalidates the old approval
    q.recordEvidence(classify({ ...base, readAt: "later" }), now + 1);
    expect(oms.releaseApproved(CID, q).ok).toBe(false);
    const b = q.approve(CID, "sam", "", now + 2);
    expect(b.ok).toBe(true);
    expect(oms.releaseApproved(CID, q).ok).toBe(true);
    expect(oms.pendingIntents()).toEqual([]);
    expect(readFileSync(join(dir, "oms-journal.jsonl"), "utf8")).toContain('"stage":"released"');
    expect(q.rows().map((r) => r.kind)).toEqual(["evidence", "approval", "evidence", "approval", "released"]);
    expect(q.pending()).toEqual([]);
  });
  it("recordFound writes the exchange record for an ambiguous send", () => {
    const { oms } = setup();
    expect(oms.recordFound(classify({ ...base, orders: [{ order_id: "z", client_order_id: CID, ticker: T, status: "canceled" }] }))).toBe(true);
    expect(oms.isAmbiguous(CID)).toBe(false);
  });
});

describe("read-only by construction", () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8") as string;
  it("the read-only client, recovery and the recovery CLI never reference an order write", () => {
    for (const f of ["./kalshi-readonly.ts", "./recovery.ts", "../../../scripts/desk-recover.ts"]) {
      const s = src(f);
      expect(s).not.toMatch(/kalshiOrderPost|kalshiDelete|kalshiSignedHeaders\(\s*"(POST|DELETE)"|method:\s*"(POST|DELETE|PUT|PATCH)"/);
      expect(s).not.toMatch(/\.submit\(|\.cancel\(/);
    }
  });
  it("path allow-list: portfolio reads and market status only", () => {
    expect(readOnlyPathAllowed("/trade-api/v2/portfolio/fills?ticker=KXBTC15M-26OCT081200-00&limit=200")).toBe(true);
    expect(readOnlyPathAllowed("/trade-api/v2/markets/KXBTC15M-26OCT081200-00")).toBe(true);
    expect(readOnlyPathAllowed("/trade-api/v2/portfolio/events/orders")).toBe(false);
    expect(readOnlyPathAllowed("/trade-api/v2/portfolio/orders/abc/amend")).toBe(false);
    expect(readOnlyPathAllowed("/trade-api/v2/portfolio/orders/batched")).toBe(false);
  });
  it("the process guard refuses POST/DELETE before any request leaves", async () => {
    const real = globalThis.fetch;
    let reached = 0;
    globalThis.fetch = (async () => { reached += 1; return new Response("{}"); }) as unknown as typeof fetch;
    const g = globalThis as unknown as { __deskReadOnly?: unknown };
    delete g.__deskReadOnly;
    try {
      const stats = installReadOnlyFetch();
      await expect(fetch("https://api.elections.kalshi.com/trade-api/v2/portfolio/events/orders", { method: "POST", body: "{}" })).rejects.toThrow("read-only process");
      await expect(fetch("https://api.elections.kalshi.com/trade-api/v2/portfolio/events/orders/x", { method: "DELETE" })).rejects.toThrow("read-only process");
      await fetch("https://api.elections.kalshi.com/trade-api/v2/markets/X");
      expect(reached).toBe(1);
      expect(stats.refused).toBe(2);
    } finally {
      globalThis.fetch = real;
      delete g.__deskReadOnly;
    }
  });
});
