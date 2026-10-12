import { describe, expect, it } from "bun:test";
import { exchangeStatus } from "./kalshi-read";

const withFetch = async (body: unknown, f: () => Promise<void>) => {
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  try { await f(); } finally { globalThis.fetch = real; }
};

describe("Kalshi exchange shard status (read-only)", () => {
  it("shard 2 paused → not tradable even if the exchange is active", async () => {
    await withFetch({ exchange_active: true, trading_active: true, exchange_index_statuses: [{ exchange_index: 1, trading_active: true, exchange_active: true }, { exchange_index: 2, trading_active: false, exchange_active: true }] }, async () => {
      const s = await exchangeStatus();
      expect(s.shard2).toBe(false);
      expect(s.tradingActive).toBe(false);
    });
  });
  it("shard 2 active and exchange active → tradable", async () => {
    await withFetch({ exchange_active: true, trading_active: true, exchange_index_statuses: [{ exchange_index: 2, trading_active: true, exchange_active: true }] }, async () => {
      expect((await exchangeStatus()).tradingActive).toBe(true);
    });
  });
  it("shard 2 record absent → not tradable (fail closed)", async () => {
    await withFetch({ exchange_active: true, trading_active: true }, async () => {
      expect((await exchangeStatus()).tradingActive).toBe(false);
    });
  });
  it("exchange inactive → not tradable", async () => {
    await withFetch({ exchange_active: false, trading_active: false }, async () => {
      expect((await exchangeStatus()).tradingActive).toBe(false);
    });
  });
});
