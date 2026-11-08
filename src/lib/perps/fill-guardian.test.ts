import { describe, expect, it } from "bun:test";
import { FakeExchange, PerpsOms, type Intent } from "./oms";
import { reconcileFilledProtection } from "./fill-guardian";

const entry: Intent = {
  kind: "entry", ticker: "KXBTCPERP", dir: "long", qty: 3, price: 8.36, maker: true,
  decisionId: "maker-fill-guardian",
  plan: { dir: "long", qty: 3, entry: 8.36, stop: 8.26, t1: 8.46, t2: 8.66,
    partialFrac: 0.5, trailR: 1, maxHoldMs: 3600_000 },
};
describe("persistent perps fill guardian", () => {
  it("does not treat a resting order as a fill", async () => {
    const x = new FakeExchange();
    const o = new PerpsOms(x, null, true, () => ({ ok:true, why:"test" }));
    expect((await o.submit(entry)).status).toBe("ACK");
    const r = await reconcileFilledProtection(o, x);
    expect(r).toMatchObject({ status:"OK", openPositions:0, verified:0 });
  });
  it("confirms a maker's later fill using venue position, fill and active trigger", async () => {
    const x = new FakeExchange();
    const o = new PerpsOms(x, null, true, () => ({ ok:true, why:"test" }));
    const ack = await o.submit(entry);
    x.applyFill(ack.order_id!, entry.ticker, "bid", 3, 8.36, false);
    const result = await reconcileFilledProtection(o, x);
    expect(result).toMatchObject({ status:"OK", openPositions:1, verified:1 });
    expect(o.stateOf(ack.cid)).toBe("PROTECTION_VERIFIED");
  });
  it("latches unknown external positions instead of guessing the originating order", async () => {
    const x = new FakeExchange();
    const o = new PerpsOms(x, null, true, () => ({ ok:true, why:"test" }));
    x.applyFill("external-order", "KXGOLDPERP", "bid", 1, 4.1, true);
    const result = await reconcileFilledProtection(o, x);
    expect(result.status).toBe("INCIDENT");
    expect(o.blocked).toContain("unmanaged");
  });
});
