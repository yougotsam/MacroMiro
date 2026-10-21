import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { journalFills, promotionFromDisk, verifiedFillRows } from "./fill-ledger";
import type { JournalRow } from "./oms";

describe("journal-verified fills", () => {
  it("keeps a real fill and drops a shadow that never filled", () => {
    const rows: JournalRow[] = [
      { ts: "t", cid: "mm1-KXBTC15M-26OCT200945-45-y-1", stage: "sent", ticker: "KXBTC15M-26OCT200945-45", fill: 0, mode: "maker" },
      { ts: "t2", cid: "mm1-KXBTC15M-26OCT200945-45-y-1", stage: "found", ticker: "KXBTC15M-26OCT200945-45", fill: 4, fee: 0, feeSource: "exchange", mode: "maker" },
      { ts: "t", cid: "mm1-KXETH15M-26OCT200945-45-n-1", stage: "rejected", ticker: "KXETH15M-26OCT200945-45", fill: 0 },
    ];
    const fills = journalFills(rows);
    expect(fills).toHaveLength(1);
    expect(fills[0].fill).toBe(4);
    expect(fills[0].fee).toBe(0);
  });
  it("does not charge a made-up taker fee when Kalshi never reported one", () => {
    const fills = journalFills([
      { ts: "t", cid: "c1", stage: "sent", ticker: "KXBTC15M-X", fill: 3, mode: "taker" },
    ]);
    const buy = new Map([["c1", {
      cid: "c1", ticker: "KXBTC15M-X", series: "KXBTC15M", ts: "2026-10-20T00:00:00Z", close: "2026-10-20T00:15:00Z",
      tte: 60, p: 0.6, yesBid: 0.55, yesAsk: 0.57, side: "yes" as const, mode: "taker" as const, price: 0.57,
      setup: "settlement-model", indexAge: 100, bookAge: 100,
    }]]);
    const built = verifiedFillRows(fills, buy, new Map([["KXBTC15M-X", "yes"]]));
    expect(built.rows).toHaveLength(0);
    expect(built.unverified).toBe(1);
  });
  it("a verified maker fill at fee 0 is filled true", () => {
    const fills = journalFills([
      { ts: "t", cid: "c1", stage: "found", ticker: "KXBTC15M-X", fill: 2, fee: 0, feeSource: "exchange", mode: "maker" },
    ]);
    const buy = new Map([["c1", {
      cid: "c1", ticker: "KXBTC15M-X", series: "KXBTC15M", ts: "2026-10-20T00:00:00Z", close: "2026-10-20T00:15:00Z",
      tte: 40, p: 0.2, yesBid: 0.7, yesAsk: 0.72, side: "no" as const, mode: "maker" as const, price: 0.25,
      setup: "settlement-model", indexAge: 100, bookAge: 100,
    }]]);
    const built = verifiedFillRows(fills, buy, new Map([["KXBTC15M-X", "no"]]));
    expect(built.rows).toHaveLength(1);
    expect(built.rows[0].filled).toBe(true);
    expect(built.rows[0].pnlAfterFees).toBeCloseTo(0.75, 6);
  });
  it("an empty directory stays research and does not invent an eligible setup", () => {
    const dir = mkdtempSync(`${tmpdir()}/mm-promo-`);
    const p = promotionFromDisk(dir, 1);
    expect(p.verified).toBe(0);
    expect(p.doc.setups["settlement-model"].state).toBe("RESEARCH");
    expect(p.why).toContain("flat budget stays until ELIGIBLE");
  });
});
