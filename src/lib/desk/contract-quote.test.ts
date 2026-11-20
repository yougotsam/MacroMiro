import { expect, it } from "bun:test";
import { Feeds } from "./feeds";
import { estimateContractSettlement } from "./contract-quote";

const now = Math.floor(Date.now() / 1000) * 1000;
function feed(index: string, missing: number | null = null) {
  const f = new Feeds(false);
  for (let t = now - 60 * 60_000; t <= now; t += 1_000) {
    if (t === missing) continue;
    f.push(index, t, 100 + 0.05 * Math.sin((t - now) / 19_000), now);
  }
  return f;
}

it("scores actual crypto 60-print settlement against the contract strike, not the next candle", () => {
  const f = feed("BRTI");
  const q = estimateContractSettlement(f, "KXBTC15M", { strike: 100, closeMs: now + 35_000 }, now);
  expect(q.ok).toBe(true);
  if (!q.ok) return;
  expect(q.pYes).toBeGreaterThan(0);
  expect(q.pYes).toBeLessThan(1);
  expect(q.sigma).toBeGreaterThan(0);
});

it("fails closed if a final-minute index print is missing", () => {
  const f = feed("BRTI", now - 10_000);
  const q = estimateContractSettlement(f, "KXBTC15M", { strike: 100, closeMs: now + 35_000 }, now);
  expect(q).toEqual({ ok: false, why: "settlement_index_window_incomplete_or_invalid" });
});

it("fails closed when the last price is stale, even if old samples are plentiful", () => {
  const f = feed("BRTI");
  const q = estimateContractSettlement(f, "KXBTC15M", { strike: 100, closeMs: now + 35_000 }, now + 10_000);
  expect(q).toEqual({ ok: false, why: "index_missing_or_stale" });
});

it("evaluates gold using the Pyth close formula, not 60 RTI prints", () => {
  const f = feed("Metal.Index.1OZGOLD/USD");
  const q = estimateContractSettlement(f, "KXGOLD15M", { strike: 100, closeMs: now + 35_000 }, now);
  expect(q.ok).toBe(true);
  if (q.ok) expect(q.evidence).toContain("to close");
});

it("refuses unknown contract strike or close", () => {
  const f = feed("BRTI");
  expect(estimateContractSettlement(f, "KXBTC15M", { strike: 0, closeMs: now + 60_000 }, now).ok).toBe(false);
  expect(estimateContractSettlement(f, "KXBTC15M", { strike: 100, closeMs: now }, now).ok).toBe(false);
});
