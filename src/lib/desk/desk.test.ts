import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cryptoProb, goldProb } from "./settlement";
import { nextGridBid, scoreSides } from "./gate";
import { RiskEngine, dayWorstOf, type AccountSnapshot, type OrderIntent } from "./risk";
import { Oms } from "./oms";
import { buildSnapshot } from "./kalshi-read";
import { CALIBRATED_MODEL_APPROVED, DAILY_STOP_USD, ENABLE_RISK_OVERRIDES } from "./config";

const NOW = Date.parse("2026-10-09T16:30:00Z");
const T = "KXBTC15M-26OCT091230-30";
const permit = { live: () => true, begin: () => true, arm: () => true };
const folder = () => mkdtempSync(join(tmpdir(), "aurix-desk-"));
const intent = (extra: Partial<OrderIntent> = {}): OrderIntent => ({
  product: "event", ticker: T, side: "yes", mode: "taker", price: 0.5,
  count: 2, fee: 0.01, tickId: 1, ...extra,
});
const snap = (extra: Partial<AccountSnapshot> = {}): AccountSnapshot => ({
  fetchedAt: NOW, etDay: "2026-10-09", realizedToday: 0, openWorst: 0,
  restWorst: 0, pendingWorst: 0, shard2Cash: 36, settledToday: [],
  ordersPerTicker: {}, exchangeTradingActive: true, exchangeCheckedAt: NOW,
  ...extra,
});

describe("AURIX-X risk and emergency stops", () => {
  it("refuses any unapproved model at the final OMS choke point", async () => {
    expect(CALIBRATED_MODEL_APPROVED).toBe(false);
    let sends = 0;
    const risk = new RiskEngine(folder(), permit);
    const oms = new Oms(risk, async () => {
      sends++; throw Error("unapproved send should not happen");
    }, async () => [], folder());
    const result = await oms.submit(intent(), snap());
    expect(result.ok).toBe(false);
    expect(sends).toBe(0);
  });

  it("enforces the -$5 risk stop and keeps an existing latch after restart", () => {
    expect(DAILY_STOP_USD).toBe(-5);
    const dir = folder();
    const risk = new RiskEngine(dir, permit);
    risk.observe(snap({ realizedToday: -5.2 }), NOW);
    expect(risk.latched(NOW)).not.toBeNull();
    const restarted = new RiskEngine(dir, permit);
    expect(restarted.latched(NOW)).not.toBeNull();
    expect(restarted.check(intent(), snap(), NOW).ok).toBe(false);
  });

  it("does not allow dated overrides to rebase losses", () => {
    expect(ENABLE_RISK_OVERRIDES).toBe(false);
    const dir = folder();
    writeFileSync(join(dir, "risk-override-20261009.json"),
      JSON.stringify({ id: "old", kind: "fresh_from_start", start: "2026-10-09T12:00:00Z",
        expires: "2026-10-10T04:00:00Z" }));
    const risk = new RiskEngine(dir, permit);
    const s = snap({ realizedToday: -4.8 });
    expect(dayWorstOf(risk.effective(s, NOW))).toBeCloseTo(-4.8);
    expect(risk.check(intent(), s, NOW).ok).toBe(false);
  });

  it("fails closed when a previously created risk-state file is unreadable", () => {
    const dir = folder();
    writeFileSync(join(dir, "risk-state.json"), "{corrupt");
    expect(new RiskEngine(dir, permit).latched(Date.now())).not.toBeNull();
  });

  it("rejects invalid financial values rather than NaN passing comparisons", () => {
    const risk = new RiskEngine(folder(), permit);
    for (const o of [
      intent({ price: Number.NaN }),
      intent({ fee: Number.NaN }),
      intent({ count: -2 }),
      intent({ tickId: Number.NaN }),
    ]) expect(risk.check(o, snap(), NOW).ok).toBe(false);
    expect(risk.check(intent(), snap({ openWorst: Number.NaN }), NOW).ok).toBe(false);
    expect(risk.check(intent(), snap({ shard2Cash: Number.NaN }), NOW).ok).toBe(false);
  });

  it("includes unknown pending order worst-case in all aggregate risk", () => {
    const s = snap({ realizedToday: -1, openWorst: 1.5, restWorst: 0.5, pendingWorst: 2 });
    expect(dayWorstOf(s)).toBe(-5);
    const risk = new RiskEngine(folder(), permit);
    expect(risk.check(intent(), s, NOW).ok).toBe(false);
  });
});

describe("AURIX-X official settlement inputs", () => {
  const close = Date.parse("2026-10-09T16:45:00Z");
  const sec = close / 1000;
  const window = () => new Map(Array.from({ length: 60 },
    (_, i) => [(sec-59+i)*1000, 100]));
  it("excludes the :00 boundary 60 seconds before close and includes close", () => {
    const w = window();
    w.set((sec - 60) * 1000, 10);
    w.set(close, 160);
    const out = cryptoProb({ closeMs: close, strike: 100.95, dp: 2,
      last: { t: close, v: 160 }, windowPrints: w, sigma: 0.0001 });
    expect(out.printed).toBe(60);
    expect(out.mean).toBeCloseTo(101);
    expect(out.p).toBe(1);
  });
  it("throws when any already-observed final-window tick is missing", () => {
    const w = window(); w.delete((sec - 10)*1000);
    expect(()=>cryptoProb({closeMs:close,strike:100,dp:2,
      last:{t:close,v:100},windowPrints:w,sigma:0.0001})).toThrow();
  });
  it("trusts only authenticated count- and time-matched official accumulator", () => {
    const w=window();w.delete((sec-5)*1000);
    const out=cryptoProb({closeMs:close,strike:100,dp:2,
      last:{t:close,v:100},windowPrints:w,sigma:.0001,
      official:{value:100,count:60,t:close}});
    expect(out.p).toBe(1);
    expect(()=>cryptoProb({closeMs:close,strike:100,dp:2,
      last:{t:close,v:100},windowPrints:w,sigma:.0001,
      official:{value:100,count:59,t:close}})).toThrow();
  });
  it("rejects invalid gold volatility", () => {
    expect(()=>goldProb({closeMs:close,strike:100,dp:2,
      last:{t:close-1000,v:100},sigma:0})).toThrow();
  });
});

describe("AURIX-X Kalshi risk snapshot", () => {
  const input = () => ({
    now: NOW, settlements: [] as Array<any>, positions: [] as Array<any>,
    resting: [] as Array<any>, ordersToday: [] as Array<any>,
    shard2Cash: 36, exchangeTradingActive: true, exchangeCheckedAt: NOW,
  });
  it("does not invent unknown position exposure as zero", () => {
    const p=input(); p.positions=[{ ticker: T, position_fp: "2", fees_paid_dollars: "0" }];
    expect(()=>buildSnapshot(p)).toThrow();
  });
  it("rejects corrupted monetary fields", () => {
    const p=input(); p.resting=[{ ticker: T, side:"bid",
      yes_price_dollars:"BAD", remaining_count_fp:"2" }];
    expect(()=>buildSnapshot(p)).toThrow();
  });
  it("counts unresolved risk in a clean snapshot", () => {
    const p=input();
    const result=buildSnapshot({...p, pendingIntents:[{cid:"mm1-"+T+"-y-1", worst:2}]});
    expect(result.pendingWorst).toBe(2);
  });
});

describe("AURIX-X market price and probability acceptance", () => {
  it("uses market-specific price ticks", () => {
    const bands = [{start:0, end:.1, step:.001},
      {start:.1,end:.9,step:.01}, {start:.9,end:1,step:.001}];
    expect(nextGridBid(.09,bands)).toBeCloseTo(.091);
    expect(nextGridBid(.1,bands)).toBeCloseTo(.11);
    expect(nextGridBid(.9,bands)).toBeCloseTo(.901);
    expect(nextGridBid(.4,[])).toBeNull();
  });
  it("refuses NaN forecast instead of inferring a fair contract", () => {
    const book={yesBid:{price:.45,size:10},noBid:{price:.50,size:10},ts:NOW};
    expect(scoreSides(Number.NaN,.5,book,{feeType:"quadratic",multiplier:1}).best).toBeNull();
  });
});
