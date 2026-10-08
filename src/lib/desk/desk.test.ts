import { describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { DAILY_STOP_USD, MAX_ORDER_COST_USD, PRICE_MAX, TICKER_RE } from "./config";
import { orderFee, quadraticFee, quadraticFeeFills } from "./fees";
import { featureShift } from "./features";
import { scoreSides, sizeFor, type Book } from "./gate";
import { buildSnapshot, tickerOfCid, type KOrder } from "./kalshi-read";
import { cidFor, Oms, ORDER_PATH, orderBody, type PostResult } from "./oms";
import { RiskEngine, dayWorstOf, streakPauseUntil, type AccountSnapshot, type OrderIntent } from "./risk";
import { cryptoProb, goldProb, normCdf, sigmaFromPrints } from "./settlement";
import { etDay, etDayStart } from "./time";

const ON = { live: () => true, begin: () => true, arm: () => true };
const tmp = (p: string) => mkdtempSync(join(tmpdir(), `desk-${p}-`));
const NOW = Date.now();
const T = "KXBTC15M-26OCT081200-00";

function snap(over: Partial<AccountSnapshot> = {}): AccountSnapshot {
  return {
    fetchedAt: NOW,
    etDay: etDay(NOW),
    realizedToday: 0,
    openWorst: 0,
    restWorst: 0,
    pendingWorst: 0,
    shard2Cash: 36,
    settledToday: [],
    ordersPerTicker: {},
    exchangeTradingActive: true,
    exchangeCheckedAt: NOW,
    ...over,
  };
}
function intent(over: Partial<OrderIntent> = {}): OrderIntent {
  return { product: "event", ticker: T, side: "yes", mode: "maker", price: 0.5, count: 2, fee: 0, tickId: 1, ...over };
}
function spyTransport(res: PostResult = { status: 201, body: { order_id: "oid-1", fill_count: "0.00", remaining_count: "2.00" }, text: "" }) {
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
  const t = async (path: string, body: Record<string, unknown>) => {
    calls.push({ path, body });
    return res;
  };
  return { t, calls };
}

describe("risk layer: −$15 daily stop at the submit choke point", () => {
  it("(a) ledger at −$14.50 rejects a $1 order and nothing is sent", async () => {
    const dir = tmp("a");
    const risk = new RiskEngine(dir, ON);
    const s = snap({ realizedToday: -14.5 });
    const v = risk.check(intent({ price: 0.5, count: 2 }), s, NOW);
    expect(v.ok).toBe(false);
    expect(v.why).toContain("would breach daily stop");
    expect(v.projected).toBeCloseTo(-15.5, 6);
    const { t, calls } = spyTransport();
    const oms = new Oms(risk, t, async () => [], dir);
    const r = await oms.submit(intent({ price: 0.5, count: 2 }), s);
    expect(r.ok).toBe(false);
    expect(calls.length).toBe(0);
    expect(oms.journal().length).toBe(0);
  });

  it("the same $1 order passes at −$13.50, and exactly one POST goes out with a persisted client_order_id", async () => {
    const dir = tmp("a2");
    const risk = new RiskEngine(dir, ON);
    let journalAtSend = 0;
    const calls: Array<Record<string, unknown>> = [];
    const oms: Oms = new Oms(
      risk,
      async (path, body) => {
        expect(path).toBe(ORDER_PATH);
        journalAtSend = oms.journal().filter((r) => r.stage === "intent" && r.cid === body.client_order_id).length;
        calls.push(body);
        return { status: 201, body: { order_id: "oid-1", fill_count: "0.00", remaining_count: "2.00" }, text: "" };
      },
      async () => [],
      dir,
    );
    const r = await oms.submit(intent({ price: 0.5, count: 2 }), snap({ realizedToday: -13.5 }));
    expect(r.ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(journalAtSend).toBe(1);
    expect(calls[0].client_order_id).toBe(cidFor(T, "yes", 1));
  });

  it("open positions, resting orders and unconfirmed sends count at worst case", () => {
    const risk = new RiskEngine(tmp("w"), ON);
    const s = snap({ realizedToday: -10, openWorst: 3, restWorst: 1.2, pendingWorst: 0.4 });
    expect(dayWorstOf(s)).toBeCloseTo(-14.6, 6);
    expect(risk.check(intent({ price: 0.5, count: 2 }), s, NOW).ok).toBe(false);
    expect(risk.check(intent({ price: 0.2, count: 2 }), s, NOW).ok).toBe(true);
  });

  it("taker fees count toward the order's worst case", () => {
    const risk = new RiskEngine(tmp("f"), ON);
    const fee = quadraticFee(2, 0.5);
    const v = risk.check(intent({ mode: "taker", price: 0.5, count: 2, fee }), snap({ realizedToday: -14 }), NOW);
    expect(v.orderWorst).toBeCloseTo(1 + fee, 6);
    expect(v.ok).toBe(false);
  });

  it("(d) the daily latch survives a restart and clears on the next ET day", () => {
    const dir = tmp("d");
    const r1 = new RiskEngine(dir, ON);
    r1.observe(snap({ realizedToday: -12, openWorst: 3.2 }), NOW);
    expect(r1.latched(NOW)).not.toBeNull();
    const r2 = new RiskEngine(dir, ON); // "restart": fresh process state, same data dir
    expect(r2.latched(NOW)).not.toBeNull();
    const v = r2.check(intent({ price: 0.05, count: 1 }), snap({ realizedToday: 5 }), NOW);
    expect(v.ok).toBe(false);
    expect(v.why).toContain("daily stop latched");
    const tomorrow = etDayStart(NOW) + 36 * 3600_000;
    expect(r2.latched(tomorrow)).toBeNull();
  });

  it("(c) perps are refused by the risk layer and the perp route is gone", async () => {
    const dir = tmp("c");
    const risk = new RiskEngine(dir, ON);
    expect(risk.check(intent({ product: "perp", ticker: "KXBTCPERP" }), snap(), NOW).why).toBe("perps disabled");
    const { t, calls } = spyTransport();
    const r = await new Oms(risk, t, async () => [], dir).submit(intent({ product: "perp", ticker: "KXBTCPERP" }), snap());
    expect(r.ok).toBe(false);
    expect(calls.length).toBe(0);
    const route = readFileSync(new URL("../../routes/api/live/perp-fire.ts", import.meta.url), "utf8");
    expect(route).toContain("status: 410");
    expect(route).not.toMatch(/kalshi|order\(/i);
  });

  it("switches, ARM, stale snapshot, other ET day and paused exchange all refuse", () => {
    const s = snap();
    const i = intent();
    expect(new RiskEngine(tmp("s1"), { ...ON, live: () => false }).check(i, s, NOW).why).toBe("switch kalshi_live off");
    expect(new RiskEngine(tmp("s2"), { ...ON, begin: () => false }).check(i, s, NOW).why).toBe("switch kalshi_begin off");
    expect(new RiskEngine(tmp("s3"), { ...ON, arm: () => false }).check(i, s, NOW).why).toBe("ARM off");
    const r = new RiskEngine(tmp("s4"), ON);
    expect(r.check(i, null, NOW).ok).toBe(false);
    expect(r.check(i, snap({ fetchedAt: NOW - 25_000 }), NOW).why).toBe("account snapshot stale");
    expect(r.check(i, snap({ etDay: "2001-01-01" }), NOW).ok).toBe(false);
    expect(r.check(i, snap({ exchangeTradingActive: false }), NOW).why).toContain("exchange trading paused");
    expect(r.check(i, snap({ exchangeCheckedAt: NOW - 20_000 }), NOW).why).toContain("exchange trading paused");
  });

  it("per-order $3 cap, $12 exposure cap, 3 orders per ticker, 1 order per tick, band, cash", () => {
    const r = new RiskEngine(tmp("caps"), ON);
    expect(r.check(intent({ price: 0.5, count: 7 }), snap(), NOW).why).toContain("order cost");
    expect(r.check(intent({ price: 0.5, count: 2 }), snap({ openWorst: 8, restWorst: 3.5 }), NOW).why).toContain("exposure");
    expect(r.check(intent(), snap({ ordersPerTicker: { [T]: 3 } }), NOW).why).toContain("ticker order cap");
    expect(r.check(intent({ price: 0.95, count: 1 }), snap(), NOW).why).toBe("price band");
    expect(r.check(intent({ price: 0.03, count: 1 }), snap(), NOW).why).toBe("price band");
    expect(r.check(intent({ ticker: "KXLLM1-26OCT12-OPEN" }), snap(), NOW).ok).toBe(false);
    expect(r.check(intent(), snap({ shard2Cash: 0.5 }), NOW).why).toContain("shard 2 cash");
    const i = intent({ tickId: 77 });
    expect(r.check(i, snap(), NOW).ok).toBe(true);
    r.consume(i);
    expect(r.check({ ...i, ticker: "KXETH15M-26OCT081200-00" }, snap(), NOW).why).toBe("one order per tick");
    expect(r.check({ ...i, tickId: 78 }, snap(), NOW).ok).toBe(true);
  });

  it("3 losing settlements in a row pause entries for 60 minutes; a win resets", () => {
    const t0 = NOW - 10 * 60_000;
    const L = (k: number, pnl = -1) => ({ ticker: T, pnl, settledMs: t0 + k * 1000 });
    expect(streakPauseUntil([L(1), L(2), L(3, 0.5), L(4)])).toBe(0);
    const until = streakPauseUntil([L(1), L(2), L(3)]);
    expect(until).toBe(t0 + 3000 + 60 * 60_000);
    const r = new RiskEngine(tmp("streak"), ON);
    expect(r.check(intent(), snap({ settledToday: [L(1), L(2), L(3)] }), NOW).why).toContain("loss streak pause");
  });
});

describe("one order path", () => {
  const SRC = new URL("../..", import.meta.url).pathname;
  const ROOT = new URL("../../..", import.meta.url).pathname;
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      if (n === "node_modules" || n.startsWith(".")) continue;
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs|js)$/.test(n) && !/\.test\./.test(n)) files.push(p);
    }
  };
  walk(SRC);
  walk(join(ROOT, "scripts"));
  const text = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
  const rel = (f: string) => relative(ROOT, f);

  it("(b) only the risk-gated OMS can sign a write to Kalshi", () => {
    const writers = files.filter((f) => /kalshiSignedHeaders\(\s*"(POST|PUT|PATCH)"/.test(text.get(f)!));
    expect(writers.map(rel)).toEqual(["src/lib/desk/oms.ts"]);
    const signers = files.filter((f) => /\bsignKalshi\b|kalshi_private|\.pem\b/.test(text.get(f)!));
    expect(signers.map(rel)).toEqual(["src/lib/scan/kalshi-auth.ts"]);
    const auth = text.get(join(SRC, "lib/scan/kalshi-auth.ts"))!;
    expect(auth).not.toMatch(/export (async )?function kalshi(Post|Put|Patch)\b/);
    expect(auth).not.toMatch(/method:\s*"(POST|PUT|PATCH)"/);
    const order = files.filter((f) => /portfolio\/events\/orders|portfolio\/orders["`]|\/margin\/orders/.test(text.get(f)!) && /method:\s*"POST"|kalshiSignedHeaders\("POST"/.test(text.get(f)!));
    expect(order.map(rel)).toEqual(["src/lib/desk/oms.ts"]);
  });

  it("the OMS POST is only reachable through Oms.submit, which calls risk.check first", () => {
    const oms = text.get(join(SRC, "lib/desk/oms.ts"))!;
    const body = oms.slice(oms.indexOf("async submit("));
    expect(body.indexOf("this.risk.check(")).toBeGreaterThan(-1);
    expect(body.indexOf("this.risk.check(")).toBeLessThan(body.indexOf("this.transport("));
    const users = files.filter((f) => /kalshiOrderPost|new Oms\(/.test(text.get(f)!)).map(rel).sort();
    expect(users).toEqual(["src/lib/desk/engine.ts", "src/lib/desk/oms.ts"]);
    const engine = text.get(join(SRC, "lib/desk/engine.ts"))!;
    expect(engine).not.toMatch(/transport\(|kalshiOrderPost\(|fetch\([^)]*orders/);
  });

  it("no file in the web app or scripts imports the old order modules", () => {
    for (const [f, t] of text) {
      expect({ f: rel(f), bad: /scan\/kalshi-order"|kalshi-perp-order|envelope\/exec|perp-run\.server|placeEventOrder|placePerpOrder|submitBinary/.test(t) }).toEqual({ f: rel(f), bad: false });
    }
  });
});

describe("OMS idempotency", () => {
  it("a timed-out send is never re-sent; it is reconciled by client_order_id", async () => {
    const dir = tmp("idem");
    let posts = 0;
    let visible = false;
    const lookup = async (cids: string[]): Promise<KOrder[]> =>
      visible ? cids.map((c) => ({ order_id: "oid-9", client_order_id: c, ticker: T, status: "resting", fill_count_fp: "0.00" })) : [];
    const oms = new Oms(
      new RiskEngine(dir, ON),
      async () => {
        posts += 1;
        throw new Error("The operation timed out.");
      },
      lookup,
      dir,
    );
    const r = await oms.submit(intent(), snap());
    expect(r.ok).toBe(false);
    expect(r.why).toContain("not re-sent");
    expect(posts).toBe(1);
    expect(oms.pendingWorst()).toBeCloseTo(1, 6);
    visible = true;
    await oms.reconcilePending();
    expect(posts).toBe(1);
    const stages = oms.journal().map((j) => j.stage);
    expect(stages).toEqual(["intent", "unknown", "found"]);
    expect(oms.perTicker()[T]).toBe(1);
  });

  it("order bodies: NO is a V2 ask at 1 − price; maker is post-only GTC; taker is IOC; shard 2", () => {
    const no = orderBody(intent({ side: "no", price: 0.8, mode: "maker" }), "c1");
    expect(no.side).toBe("ask");
    expect(no.price).toBe("0.2000");
    expect(no.post_only).toBe(true);
    expect(no.time_in_force).toBe("good_till_canceled");
    expect(no.exchange_index).toBe(2);
    expect(no.cancel_order_on_pause).toBe(true);
    const yes = orderBody(intent({ side: "yes", price: 0.31, mode: "taker", count: 3 }), "c2");
    expect(yes.side).toBe("bid");
    expect(yes.price).toBe("0.3100");
    expect(yes.count).toBe("3.00");
    expect(yes.time_in_force).toBe("immediate_or_cancel");
    expect(yes.post_only).toBe(false);
    expect(cidFor(T, "no", 4)).toBe(`mm1-${T}-n-4`);
  });
});

describe("fees", () => {
  const fills = JSON.parse(readFileSync(new URL("./fixtures/fills.json", import.meta.url), "utf8")) as Array<{ ticker: string; taker: boolean; fills: Array<{ price: number; count: number }>; fee: number }>;
  const fifteen = fills.filter((f) => /15M-/.test(f.ticker));
  it("quadratic taker fee + Kalshi rounding reproduces every recorded 15m taker order", () => {
    const takers = fifteen.filter((f) => f.taker);
    expect(takers.length).toBeGreaterThan(100);
    const bad = takers.filter((f) => Math.abs(quadraticFeeFills(f.fills) - f.fee) > 1e-6);
    expect(bad).toEqual([]);
  });
  it("maker fills are free on quadratic series", () => {
    const makers = fifteen.filter((f) => !f.taker);
    expect(makers.length).toBeGreaterThan(10);
    expect(makers.every((f) => f.fee === 0)).toBe(true);
    expect(orderFee(5, 0.5, true)).toBe(0);
    expect(orderFee(5, 0.5, true, { feeType: "flat", multiplier: 1 })).toBeGreaterThan(0);
  });
  it("examples", () => {
    expect(quadraticFee(1, 0.5)).toBe(0.0175);
    expect(quadraticFee(3.07, 0.31)).toBe(0.046);
    expect(quadraticFee(0, 0.5)).toBe(0);
  });
});

describe("settlement model", () => {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return (s + 0.5) / 4294967296;
    };
  }
  function gauss(u: () => number) {
    return Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
  }
  function mcCrypto(S0: number, K: number, sigma: number, secsToClose: number, printedVals: number[], dp: number, paths: number, seed: number) {
    const u = rng(seed);
    let yes = 0;
    for (let k = 0; k < paths; k += 1) {
      let s = S0;
      const window: number[] = [...printedVals];
      for (let t = 1; t <= secsToClose; t += 1) {
        s *= Math.exp(sigma * gauss(u));
        if (t > secsToClose - (60 - printedVals.length)) window.push(s);
      }
      const avg = window.reduce((a, b) => a + b, 0) / 60;
      if (Number(avg.toFixed(dp)) >= K) yes += 1;
    }
    return yes / paths;
  }
  const cases = [
    { name: "BTC 6 min out, 0.02% above", S0: 100_000, K: 99_980, sigma: 2e-5, close: 360, printed: 0, dp: 2 },
    { name: "BTC 2 min out, at the line", S0: 100_000, K: 100_000, sigma: 3e-5, close: 120, printed: 0, dp: 2 },
    { name: "ETH final minute, 30 prints locked", S0: 4000, K: 4000.5, sigma: 4e-5, close: 30, printed: 30, dp: 2 },
    { name: "XRP 90s out, below", S0: 1.4157, K: 1.416, sigma: 5e-5, close: 90, printed: 0, dp: 4 },
  ];
  for (const c of cases) {
    it(`closed-form P agrees with Monte Carlo within 1pp: ${c.name}`, () => {
      const closeMs = 1_800_000_000_000;
      const nowMs = closeMs - c.close * 1000;
      const window = new Map<number, number>();
      const printedVals: number[] = [];
      for (let i = 0; i < c.printed; i += 1) {
        const t = closeMs - 60_000 + i * 1000;
        window.set(t, c.S0);
        printedVals.push(c.S0);
      }
      const lastT = c.printed ? closeMs - 60_000 + (c.printed - 1) * 1000 : nowMs;
      const m = cryptoProb({ closeMs, strike: c.K, dp: c.dp, last: { t: lastT, v: c.S0 }, windowPrints: window, sigma: c.sigma });
      const secs = c.printed ? 60 - c.printed : c.close;
      const mc = mcCrypto(c.S0, c.K, c.sigma, secs, printedVals, c.dp, 20_000, 7 + c.close);
      expect(Math.abs(m.p - mc)).toBeLessThan(0.01);
    });
  }
  it("gold: P = Φ(z) of the 1-minute close agrees with Monte Carlo within 1pp", () => {
    const u = rng(42);
    const S0 = 4000;
    const K = 4000.4;
    const sigma = 6e-6;
    const tau = 240;
    let yes = 0;
    const N = 40_000;
    for (let k = 0; k < N; k += 1) if (Number((S0 * Math.exp(sigma * Math.sqrt(tau) * gauss(u))).toFixed(2)) >= K) yes += 1;
    const p = goldProb({ closeMs: tau * 1000, strike: K, dp: 2, last: { t: 0, v: S0 }, sigma }).p;
    expect(Math.abs(p - yes / N)).toBeLessThan(0.01);
  });
  it("locks once all 60 prints are in (ties go YES)", () => {
    const closeMs = 1_800_000_000_000;
    const w = new Map<number, number>();
    for (let i = 0; i < 60; i += 1) w.set(closeMs - 60_000 + i * 1000, 100);
    expect(cryptoProb({ closeMs, strike: 100, dp: 2, last: { t: closeMs - 1000, v: 100 }, windowPrints: w, sigma: 1e-4 }).p).toBe(1);
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
  });
  it("sigma needs enough samples and respects the floor", () => {
    const now = 1_800_000_000_000;
    const prints = Array.from({ length: 900 }, (_, i) => ({ t: now - (900 - i) * 1000, v: 100 }));
    expect(sigmaFromPrints(prints.slice(-30), now, 2e-5).sigma).toBeNull();
    expect(sigmaFromPrints(prints, now, 2e-5).sigma).toBe(2e-5);
  });
});

describe("execution gate: YES and NO scored separately", () => {
  const fee = { feeType: "quadratic", multiplier: 1 };
  const book = (yb: number, nb: number, ys = 50, ns = 50): Book => ({ yesBid: { price: yb, size: ys }, noBid: { price: nb, size: ns }, ts: NOW });
  const table: Array<{ name: string; p: number; pBase?: number; b: Book; side: "yes" | "no" | null; mode?: "maker" | "taker"; price?: number; failed?: string }> = [
    { name: "P 0.70, YES 60/65 → YES maker 61¢", p: 0.7, b: book(0.6, 0.35), side: "yes", mode: "maker", price: 0.61 },
    { name: "P 0.30, mirror → NO maker 61¢", p: 0.3, b: book(0.35, 0.6), side: "no", mode: "maker", price: 0.61 },
    { name: "favorite: P 0.95, YES 88/90 → YES maker 89¢", p: 0.95, b: book(0.88, 0.1), side: "yes", mode: "maker", price: 0.89 },
    { name: "P 0.50 fair book 49/51 → no trade", p: 0.5, b: book(0.49, 0.49), side: null, failed: "no_edge" },
    { name: "features alone cannot create a trade", p: 0.7, pBase: 0.6, b: book(0.63, 0.35), side: null },
    { name: "above the 93¢ band → no trade", p: 0.99, b: book(0.95, 0.04), side: null, failed: "no_edge_or_band" },
  ];
  for (const c of table) {
    it(c.name, () => {
      const g = scoreSides(c.p, c.pBase ?? c.p, c.b, fee);
      if (c.side == null) {
        expect(g.best).toBeNull();
        if (c.failed) expect(g.failed).toBe(c.failed);
        return;
      }
      expect(g.best?.side).toBe(c.side);
      expect(g.best?.mode).toBe(c.mode!);
      expect(g.best?.price).toBeCloseTo(c.price!, 6);
      expect(g.best!.count * g.best!.price + g.best!.fee).toBeLessThanOrEqual(MAX_ORDER_COST_USD + 1e-9);
    });
  }
  it("taker needs ≥4¢ after fee and takes only the top-of-book size", () => {
    const g = scoreSides(0.8, 0.8, book(0.6, 0.3, 50, 2), fee, { allowMaker: false, allowTaker: true });
    expect(g.best?.mode).toBe("taker");
    expect(g.best?.price).toBeCloseTo(0.7, 6);
    expect(g.best?.count).toBe(2);
    expect(g.best!.edge).toBeGreaterThanOrEqual(0.04);
    const thin = scoreSides(0.75, 0.75, book(0.6, 0.3), fee, { allowMaker: false, allowTaker: true });
    expect(thin.best).toBeNull();
  });
  it("a missing quote is no trade (never a 0.5 fallback)", () => {
    expect(scoreSides(0.9, 0.9, { yesBid: null, noBid: null, ts: NOW }, fee).failed).toBe("no_quote");
    const src = readFileSync(new URL("../scan/kalshi.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\|\| 0\.5;/);
  });
  it("feature shift is bounded to ±4pp", () => {
    for (const p of [0.05, 0.3, 0.5, 0.8]) for (const s of [-3, -1, 0.4, 1, 5]) expect(Math.abs(featureShift(p, s))).toBeLessThanOrEqual(0.04 + 1e-12);
    expect(PRICE_MAX).toBe(0.93);
    expect(sizeFor(0.5, true, fee)).toBe(6);
  });
});

describe("account snapshot (Kalshi records → day P/L)", () => {
  it("realized + open + resting worst case for desk series only, ET day", () => {
    const now = Date.parse("2026-10-08T15:00:00Z");
    const s = buildSnapshot({
      now,
      settlements: [
        { ticker: "KXBTC15M-26OCT081000-00", settled_time: "2026-10-08T14:15:00Z", revenue: 300, yes_total_cost_dollars: "2.10", fee_cost: "0.05" },
        { ticker: "KXETH15M-26OCT081000-00", settled_time: "2026-10-08T14:15:00Z", revenue: 0, no_total_cost_dollars: "1.50", fee_cost: "0.03" },
        { ticker: "KXETH15M-26OCT072300-00", settled_time: "2026-10-08T03:15:00Z", revenue: 0, no_total_cost_dollars: "9.00" },
        { ticker: "KXLLM1-26OCT12-OPEN", settled_time: "2026-10-08T14:15:00Z", revenue: 0, yes_total_cost_dollars: "5" },
      ],
      positions: [
        { ticker: "KXSOL15M-26OCT081100-00", position_fp: "4.00", market_exposure_dollars: "2.00", fees_paid_dollars: "0.06" },
        { ticker: "KXLLM1-26OCT12-OPEN", position_fp: "60", market_exposure_dollars: "1.87", fees_paid_dollars: "0.12" },
      ],
      resting: [{ order_id: "x", ticker: "KXXRP15M-26OCT081100-00", status: "resting", outcome_side: "no", side: "yes", yes_price_dollars: "0.2000", no_price_dollars: "0.8000", remaining_count_fp: "2.00" }],
      ordersToday: [
        { order_id: "a", client_order_id: "mm1-KXSOL15M-26OCT081100-00-y-1", ticker: "KXSOL15M-26OCT081100-00", status: "executed" },
        { order_id: "b", client_order_id: "", ticker: "KXSOL15M-26OCT081100-00", status: "executed" },
      ],
      shard2Cash: 30,
      exchangeTradingActive: true,
      exchangeCheckedAt: now,
      pendingWorst: 0.5,
      localOrdersPerTicker: { "KXSOL15M-26OCT081100-00": 2 },
    });
    expect(s.realizedToday).toBeCloseTo(3 - 2.1 - 0.05 - 1.5 - 0.03, 6);
    expect(s.openWorst).toBeCloseTo(2.06, 6);
    expect(s.restWorst).toBeCloseTo(1.6 + quadraticFee(2, 0.8), 6);
    expect(s.ordersPerTicker["KXSOL15M-26OCT081100-00"]).toBe(2);
    expect(dayWorstOf(s)).toBeCloseTo(s.realizedToday - 2.06 - s.restWorst - 0.5, 6);
    expect(s.etDay).toBe("2026-10-08");
    expect(TICKER_RE.test("KXGOLD15M-26OCT081200-00")).toBe(true);
    expect(DAILY_STOP_USD).toBe(-15);
  });
  it("ET day starts at 00:00 America/New_York", () => {
    expect(new Date(etDayStart(Date.parse("2026-10-08T15:00:00Z"))).toISOString()).toBe("2026-10-08T04:00:00.000Z");
    expect(new Date(etDayStart(Date.parse("2026-12-08T03:00:00Z"))).toISOString()).toBe("2026-12-07T05:00:00.000Z");
  });
});

describe("OMS bookkeeping", () => {
  it("a ticker just sent to is busy for 20 s even before Kalshi lists the order", async () => {
    const dir = tmp("recent");
    const { t } = spyTransport();
    const oms = new Oms(new RiskEngine(dir, ON), t, async () => [], dir);
    await oms.submit(intent(), snap());
    expect(oms.recentTickers(Date.now()).has(T)).toBe(true);
    expect(oms.recentTickers(Date.now() + 25_000).has(T)).toBe(false);
  });
});

describe("client order ids", () => {
  it("the ticker is recoverable from a desk client_order_id (lookup queries by ticker, matches the id exactly)", () => {
    expect(tickerOfCid(cidFor("KXGOLD15M-26OCT080615-15", "no", 12))).toBe("KXGOLD15M-26OCT080615-15");
    expect(tickerOfCid("9a301543-8c72-4495-bcc8-8a53866d3032")).toBeNull();
  });
});
