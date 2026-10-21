import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KOrder } from "./kalshi-read";
import { Oms } from "./oms";
import { RiskEngine } from "./risk";

const T = "KXGBPUSD15M-26OCT210615-30";
const cid = `mm1-${T}-n-1`;

function order(over: Partial<KOrder>): KOrder {
  return {
    order_id: "oid",
    ticker: T,
    client_order_id: cid,
    status: "resting",
    fill_count_fp: "0.00",
    taker_fees_dollars: "0",
    maker_fees_dollars: "0",
    ...over,
  } as KOrder;
}

function desk(lookup: (ids: string[]) => Promise<KOrder[]>, canceller: () => Promise<{ status: number }>) {
  const dir = mkdtempSync(join(tmpdir(), "cancel-"));
  return new Oms(new RiskEngine(dir), async () => ({ status: 500, body: {}, text: "" }), lookup, dir, { canceller });
}

describe("cancel that does not confirm", () => {
  it("http 0 still records the fill and the exchange fee", async () => {
    let n = 0;
    const oms = desk(async () => {
      n += 1;
      if (n === 1) throw new Error("lookup down");
      return [order({ status: "executed", fill_count_fp: "23.00", maker_fees_dollars: "0.0000" })];
    }, async () => ({ status: 0 }));
    expect(await oms.cancel("oid", T, cid, "fast move")).toBe(208);
    const row = oms.journal().at(-1)!;
    expect(row.stage).toBe("found");
    expect(row.fill).toBe(23);
    expect(row.fee).toBe(0);
    expect(row.feeSource).toBe("exchange");
    expect(row.note).toContain("cancel http 0 but filled");
  });

  it("a thrown cancel with the order still resting is not recorded as gone", async () => {
    const oms = desk(async () => [order({ status: "resting" })], async () => {
      throw new Error("network");
    });
    expect(await oms.cancel("oid", T, cid, "edge gone")).toBe(0);
    const row = oms.journal().at(-1)!;
    expect(row.stage).toBe("cancel");
    expect(row.note).toContain("http 0");
    expect(row.note).toContain("still resting");
  });

  it("http 200 is a cancel and does not look the order up again", async () => {
    let lookups = 0;
    const oms = desk(async () => {
      lookups += 1;
      return [order({ status: "resting" })];
    }, async () => ({ status: 200 }));
    expect(await oms.cancel("oid", T, cid, "pull")).toBe(200);
    expect(lookups).toBe(1);
    expect(oms.journal().at(-1)!.stage).toBe("cancel");
  });
});
