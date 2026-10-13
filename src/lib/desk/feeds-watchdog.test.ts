import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { Feeds } from "./feeds";

type Internals = { status: string; lastMsgAt: number; ws: unknown; open: () => void };

describe("feed stall watchdog (read-only market data)", () => {
  it("tears down a socket that is 'live' but silent, and reopens it", () => {
    const f = new Feeds(false);
    const x = f as unknown as Internals;
    let closed = 0, opened = 0;
    x.open = () => { opened += 1; };
    x.status = "live";
    x.ws = { close: () => { closed += 1; }, onclose: null, onmessage: null };
    x.lastMsgAt = 1_000_000;
    expect(f.checkStall(1_000_000 + Feeds.STALL_MS - 1)).toBe(false);
    expect(f.checkStall(1_000_000 + Feeds.STALL_MS + 1)).toBe(true);
    expect(closed).toBe(1);
    expect(x.status).toBe("stalled");
    expect(f.stalls).toBe(1);
    return new Promise<void>((r) => setTimeout(() => { expect(opened).toBe(1); r(); }, 700));
  });
  it("does nothing when stopped, not live, or before the first message", () => {
    const f = new Feeds(false);
    const x = f as unknown as Internals;
    x.status = "connecting"; x.lastMsgAt = 1;
    expect(f.checkStall(10 ** 9)).toBe(false);
    x.status = "live"; x.lastMsgAt = 0;
    expect(f.checkStall(10 ** 9)).toBe(false);
    f.stop(); x.status = "live"; x.lastMsgAt = 1;
    expect(f.checkStall(10 ** 9)).toBe(false);
  });
  it("reconnects when one crypto index goes silent even though other messages keep arriving", () => {
    const f = new Feeds(false);
    const x = f as unknown as Internals & { bufs: Map<string, { lastRecv: number }> };
    x.open = () => {};
    x.status = "live";
    x.ws = { close: () => {}, onclose: null, onmessage: null };
    const now = 5_000_000;
    x.lastMsgAt = now - 1_000; // gold/other messages still flowing
    for (const b of x.bufs.values()) b.lastRecv = now - 1_000;
    x.bufs.get("XRPUSD_RTI")!.lastRecv = now - 2 * Feeds.STALL_MS - 1;
    expect(f.checkStall(now)).toBe(true);
    f.stop();
  });
  it("feeds.ts still never names an order call", async () => {
    const src = readFileSync(new URL("./feeds.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/placeEventOrder|createOrder|cancelOrder|\/portfolio\/orders/);
  });
});
