/**
 * desk-v1 regression suite, restored on fix/aurix-x so the 42 checks that still hold keep running.
 * The aurix-x patch tightened policy (−$15 → −$5 day stop, $12 → $9 open cap, dated overrides off,
 * every OMS send blocked until CALIBRATED_MODEL_APPROVED). Each test whose old number no longer
 * applies is marked "POLICY (aurix-x)" and asserts the NEW stricter rule instead of being deleted.
 */
import { describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { CALIBRATED_MODEL_APPROVED, DAILY_STOP_USD, ENABLE_RISK_OVERRIDES, MAX_ORDER_COST_USD, PRICE_MAX, TICKER_RE } from "./config";
import { orderFee, quadraticFee, quadraticFeeFills } from "./fees";
import { featureShift } from "./features";
import { scoreSides, sizeFor, type Book } from "./gate";
import { buildSnapshot, tickerOfCid } from "./kalshi-read";
import { cidFor, Oms, orderBody, type PostResult } from "./oms";
import { RiskEngine, dayWorstOf, streakPauseUntil, type AccountSnapshot, type OrderIntent } from "./risk";
import { cryptoProb, goldProb, normCdf, sigmaFromPrints } from "./settlement";
import { roomBudget as roomBudgetTop } from "./sizing";
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

describe("risk layer: −$5 daily stop at the submit choke point (POLICY aurix-x: was −$15)", () => {
  it("(a) ledger at −$4.50 rejects a $1 order and nothing is sent", async () => {
    const dir = tmp("a");
    const risk = new RiskEngine(dir, ON);
    const s = snap({ realizedToday: -4.5 });
    const v = risk.check(intent({ price: 0.5, count: 2 }), s, NOW);
    expect(v.ok).toBe(false);
    expect(v.why).toContain("would breach daily stop");
    expect(v.projected).toBeCloseTo(-5.5, 6);
    const { t, calls } = spyTransport();
    const oms = new Oms(risk, t, async () => [], dir);
    const r = await oms.submit(intent({ price: 0.5, count: 2 }), s);
    expect(r.ok).toBe(false);
    expect(calls.length).toBe(0);
    expect(oms.journal().length).toBe(0);
  });

  it("POLICY (aurix-x): the same $1 order passes risk at −$3.50, but the OMS sends nothing until a calibrated model is approved", async () => {
    const dir = tmp("a2");
    const risk = new RiskEngine(dir, ON);
    expect(CALIBRATED_MODEL_APPROVED).toBe(false);
    expect(risk.check(intent({ price: 0.5, count: 2 }), snap({ realizedToday: -3.5 }), NOW).ok).toBe(true);
    const { t, calls } = spyTransport();
    const oms = new Oms(risk, t, async () => [], dir);
    const r = await oms.submit(intent({ price: 0.5, count: 2 }), snap({ realizedToday: -3.5 }));
    expect(r.ok).toBe(false);
    expect(r.why).toContain("not independently calibrated");
    expect(calls.length).toBe(0);
    expect(oms.journal().length).toBe(0);
    expect(cidFor(T, "yes", 1)).toBe(`mm1-${T}-y-1`);
  });

  it("open positions, resting orders and unconfirmed sends count at worst case", () => {
    const risk = new RiskEngine(tmp("w"), ON);
    const s = snap({ realizedToday: 0, openWorst: 3, restWorst: 1.2, pendingWorst: 0.4 });
    expect(dayWorstOf(s)).toBeCloseTo(-4.6, 6);
    expect(risk.check(intent({ price: 0.5, count: 2 }), s, NOW).ok).toBe(false);
    expect(risk.check(intent({ price: 0.2, count: 2 }), s, NOW).ok).toBe(true);
  });

  it("taker fees count toward the order's worst case", () => {
    const risk = new RiskEngine(tmp("f"), ON);
    const fee = quadraticFee(2, 0.5);
    const v = risk.check(intent({ mode: "taker", price: 0.5, count: 2, fee }), snap({ realizedToday: -4 }), NOW);
    expect(v.orderWorst).toBeCloseTo(1 + fee, 6);
    expect(v.ok).toBe(false);
  });

  it("(d) the daily latch survives a restart and clears on the next ET day", () => {
    const dir = tmp("d");
    const r1 = new RiskEngine(dir, ON);
    r1.observe(snap({ realizedToday: -2, openWorst: 3.2 }), NOW);
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

  it("per-order $3 cap, $9 exposure cap (POLICY aurix-x: was $12), 3 orders per ticker, 1 order per tick, band, cash", () => {
    const r = new RiskEngine(tmp("caps"), ON);
    expect(r.check(intent({ price: 0.5, count: 7 }), snap(), NOW).why).toContain("order cost");
    expect(r.check(intent({ price: 0.5, count: 2 }), snap({ realizedToday: 5, openWorst: 5, restWorst: 3.5 }), NOW).why).toContain("exposure");
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
  it("POLICY (aurix-x): with the model unapproved nothing is posted, so no timed-out send can exist; an unresolved intent is never auto-cleared", async () => {
    const dir = tmp("idem");
    let posts = 0;
    const oms = new Oms(
      new RiskEngine(dir, ON),
      async () => {
        posts += 1;
        throw new Error("The operation timed out.");
      },
      async () => [],
      dir,
    );
    const r = await oms.submit(intent(), snap());
    expect(r.ok).toBe(false);
    expect(r.why).toContain("not independently calibrated");
    expect(posts).toBe(0);
    // a journalled intent from an earlier run stays as pending risk even when Kalshi does not list it
    const cid = cidFor(T, "yes", 9);
    writeFileSync(join(dir, "oms-journal.jsonl"), JSON.stringify({ ts: new Date(NOW - 3600_000).toISOString(), cid, stage: "intent", ticker: T, worst: 1 }) + "\n");
    await oms.reconcilePending(NOW);
    expect(posts).toBe(0);
    expect(oms.journal().map((j) => j.stage)).toEqual(["intent"]);
    expect(oms.pendingIntents(NOW).map((x) => x.worst)).toEqual([1]);
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
      pendingIntents: [
        { cid: "mm1-KXSOL15M-26OCT081100-00-y-1", worst: 2 }, // Kalshi lists it → its own numbers count, not this
        { cid: "mm1-KXBTC15M-26OCT081100-00-n-1", worst: 0.5 }, // not listed yet → counts
      ],
      localOrdersPerTicker: { "KXSOL15M-26OCT081100-00": 2 },
    });
    expect(s.realizedToday).toBeCloseTo(3 - 2.1 - 0.05 - 1.5 - 0.03, 6);
    expect(s.openWorst).toBeCloseTo(2.06, 6);
    expect(s.restWorst).toBeCloseTo(1.6 + quadraticFee(2, 0.8), 6);
    expect(s.ordersPerTicker["KXSOL15M-26OCT081100-00"]).toBe(2);
    expect(dayWorstOf(s)).toBeCloseTo(s.realizedToday - 2.06 - s.restWorst - 0.5, 6);
    expect(s.etDay).toBe("2026-10-08");
    expect(TICKER_RE.test("KXGOLD15M-26OCT081200-00")).toBe(true);
    expect(DAILY_STOP_USD).toBe(-5); // POLICY (aurix-x): was −15
  });
  it("ET day starts at 00:00 America/New_York", () => {
    expect(new Date(etDayStart(Date.parse("2026-10-08T15:00:00Z"))).toISOString()).toBe("2026-10-08T04:00:00.000Z");
    expect(new Date(etDayStart(Date.parse("2026-12-08T03:00:00Z"))).toISOString()).toBe("2026-12-07T05:00:00.000Z");
  });
});

describe("OMS bookkeeping", () => {
  it("POLICY (aurix-x): an unapproved model sends nothing, so no ticker is marked busy", async () => {
    const dir = tmp("recent");
    const { t, calls } = spyTransport();
    const oms = new Oms(new RiskEngine(dir, ON), t, async () => [], dir);
    await oms.submit(intent(), snap());
    expect(calls.length).toBe(0);
    expect(oms.recentTickers(Date.now()).has(T)).toBe(false);
  });
});

describe("snapshot does not double count a fresh fill", () => {
  it("fill on the order record before /positions shows it counts once; listed sends are not pending", () => {
    const now = Date.parse("2026-10-08T15:00:00Z");
    const T2 = "KXETH15M-26OCT081115-15";
    const order = { order_id: "o", client_order_id: `mm1-${T2}-y-1`, ticker: T2, status: "executed", outcome_side: "yes", yes_price_dollars: "0.7100", fill_count_fp: "4.00", remaining_count_fp: "0.00" };
    const base = { now, settlements: [], resting: [], shard2Cash: 30, exchangeTradingActive: true, exchangeCheckedAt: now, pendingIntents: [{ cid: `mm1-${T2}-y-1`, worst: 2.84 }] };
    const lag = buildSnapshot({ ...base, positions: [], ordersToday: [order] });
    expect(lag.openWorst).toBeCloseTo(2.84, 6);
    expect(lag.pendingWorst).toBe(0);
    const both = buildSnapshot({ ...base, positions: [{ ticker: T2, position_fp: "4.00", market_exposure_dollars: "2.84", fees_paid_dollars: "0" }], ordersToday: [order] });
    expect(both.openWorst).toBeCloseTo(2.84, 6);
    const unseen = buildSnapshot({ ...base, positions: [], ordersToday: [] });
    expect(unseen.pendingWorst).toBeCloseTo(2.84, 6);
    expect(dayWorstOf(unseen)).toBeCloseTo(-2.84, 6);
  });
});

describe("client order ids", () => {
  it("the ticker is recoverable from a desk client_order_id (lookup queries by ticker, matches the id exactly)", () => {
    expect(tickerOfCid(cidFor("KXGOLD15M-26OCT080615-15", "no", 12))).toBe("KXGOLD15M-26OCT080615-15");
    expect(tickerOfCid("9a301543-8c72-4495-bcc8-8a53866d3032")).toBeNull();
  });
});

describe("feeds recorder", () => {
  it("a restart reloads recorded prints (gold has no REST history) without re-recording them", async () => {
    const { Feeds, GOLD } = await import("./feeds");
    const { mkdirSync, writeFileSync, readFileSync: rf } = await import("node:fs");
    const dir = process.env.DESK_DATA_DIR!;
    mkdirSync(`${dir}/prints`, { recursive: true });
    const now = Date.now();
    const f = `${dir}/prints/${etDay(now)}.jsonl`;
    const rows = Array.from({ length: 30 }, (_, k) => JSON.stringify({ i: GOLD, t: Math.floor(now / 1000) * 1000 - (30 - k) * 1000, v: 4000 + k }));
    writeFileSync(f, `${rows.join("\n")}\n`);
    const feeds = new Feeds(true);
    feeds.reloadRecorded(now);
    expect(feeds.prints(GOLD).length).toBe(30);
    feeds.flush();
    expect(rf(f, "utf8").trim().split("\n").length).toBe(30);
  });
});

describe("adverse-selection guard", () => {
  const G = async () => await import("./guard");
  const series = (vals: number[], t0 = 1_800_000_000_000) => vals.map((v, i) => ({ t: t0 + i * 1000, v }));
  const sigma = 4e-5; // per second, same σ the probability model uses

  it("a move > 3σ√L over 2–5 s against the bid side is fast; ordinary noise is not", async () => {
    const { fastMove, moveZ, against } = await G();
    const calm = series([100, 100.001, 99.999, 100.002, 100.0, 100.001, 99.999]);
    expect(fastMove(calm, sigma).dir).toBeNull();
    // 3 s drop of 0.03% = 0.0003 / (4e-5·√3) ≈ 4.3σ
    const drop = series([100, 100, 100, 100, 99.99, 99.98, 99.97]);
    const f = fastMove(drop, sigma);
    expect(f.dir).toBe("down");
    expect(f.z).toBeLessThan(-3);
    expect(Math.abs(moveZ(drop, sigma, 3)!)).toBeGreaterThan(3);
    expect(against("down", "yes")).toBe(true);
    expect(against("down", "no")).toBe(false);
    expect(against("up", "no")).toBe(true);
    // the threshold scales with σ: the same drop is not fast when the model's σ is 3× higher
    expect(fastMove(drop, 3 * sigma).dir).toBeNull();
  });

  it("after a fast move the series cools ≥10 s and stays blocked until the 5 s move settles", async () => {
    const { MoveGuard } = await G();
    const g = new MoveGuard();
    const t0 = 1_800_000_000_000;
    const drop = series([100, 100, 100, 100, 99.99, 99.98, 99.97], t0);
    const hit = g.observe("KXBTC15M", drop, sigma, t0 + 6000);
    expect(hit.cooling && hit.triggered && hit.dir === "down").toBe(true);
    expect(g.state("KXBTC15M", t0 + 15_000).cooling).toBe(true);
    // 11 s later the price keeps sliding (5 s z still large) → still cooling
    const sliding = series([100, 100, 100, 100, 99.99, 99.98, 99.97, 99.965, 99.96, 99.955, 99.95, 99.945, 99.94, 99.935, 99.93, 99.925, 99.92], t0);
    expect(g.observe("KXBTC15M", sliding, sigma, t0 + 17_000).cooling).toBe(true);
    // then flat for 6 s → settles
    const flat = [...sliding, ...series([99.92, 99.92, 99.921, 99.92, 99.92, 99.92], t0 + 17_000)];
    expect(g.observe("KXBTC15M", flat, sigma, t0 + 23_000).cooling).toBe(false);
    expect(g.state("KXETH15M", t0 + 6000).cooling).toBe(false); // other series unaffected
  });

  it("resting bids against a fast move are pulled; same-side bids are not", async () => {
    const { pullReason } = await G();
    const guard = { cooling: true, dir: "down" as const, z: -4.2, triggered: true, until: 0 };
    const base = { price: 0.6, p: 0.75, failed: null, shock: 0.01, tte: 400, lockFrac: 0, kind: "rti60" as const };
    expect(pullReason({ ...base, side: "yes", guard })).toContain("fast move down");
    expect(pullReason({ ...base, side: "no", price: 0.2, p: 0.75, guard })).toBeNull();
  });

  it("the maker edge floor rises with volatility (shock from the same σ)", async () => {
    const { shockOf } = await G();
    const p = (sig: number) => (v: number) => cryptoProb({ closeMs: 1_800_000_300_000, strike: 100, dp: 2, last: { t: 1_800_000_000_000, v }, windowPrints: new Map(), sigma: sig }).p;
    const lo = shockOf(p(2e-5), 100.02, 2e-5);
    const hi = shockOf(p(8e-5), 100.02, 8e-5);
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(lo);
    const fee = { feeType: "quadratic", multiplier: 1 };
    const book: Book = { yesBid: { price: 0.6, size: 50 }, noBid: { price: 0.35, size: 50 }, ts: NOW };
    // P 0.64 → maker at 61¢ has edge 1¢: passes the plain floor, fails once the floor includes a 2¢ shock
    expect(scoreSides(0.64, 0.64, book, fee).best?.mode).toBe("maker");
    expect(scoreSides(0.64, 0.64, book, fee, { allowMaker: true, allowTaker: true, makerMinEdge: 0.01 + 0.02 }).best).toBeNull();
  });

  it("hold threshold scales with shock (keep while edge ≥ ½ shock, post needs 1¢ + shock)", async () => {
    const { pullReason } = await G();
    const calm = { cooling: false, dir: null, z: 0.3, triggered: false, until: 0 };
    const base = { side: "yes" as const, price: 0.6, failed: null, tte: 400, lockFrac: 0, kind: "rti60" as const, guard: calm };
    expect(pullReason({ ...base, p: 0.625, shock: 0.004 })).toBeNull(); // edge 0.005 ≥ 0.002
    expect(pullReason({ ...base, p: 0.625, shock: 0.03 })).toContain("< hold"); // edge 0.005 < 0.015
  });

  it("final seconds: resting bids pulled unless ≥60% of the 60 s average is printed; gold always pulled", async () => {
    const { makerWindowOk, pullReason } = await G();
    expect(makerWindowOk(120, 0, "rti60")).toBe(true);
    expect(makerWindowOk(40, 0.33, "rti60")).toBe(false);
    expect(makerWindowOk(20, 0.67, "rti60")).toBe(true);
    expect(makerWindowOk(20, 0.67, "pyth1m")).toBe(false);
    const calm = { cooling: false, dir: null, z: 0, triggered: false, until: 0 };
    expect(pullReason({ side: "yes", price: 0.8, p: 0.95, failed: null, shock: 0, tte: 40, lockFrac: 0.33, kind: "rti60", guard: calm })).toContain("final 40s");
    // the gate stops posting makers when the window is closed
    const fee = { feeType: "quadratic", multiplier: 1 };
    const book: Book = { yesBid: { price: 0.6, size: 50 }, noBid: { price: 0.35, size: 50 }, ts: NOW };
    expect(scoreSides(0.7, 0.7, book, fee, { allowMaker: false, allowTaker: true }).best).toBeNull();
  });

  it("never buys under 5¢ in the last minute (maker or taker)", async () => {
    const { minPriceFor, pullReason } = await G();
    expect(minPriceFor(59)).toBe(0.05);
    expect(minPriceFor(61)).toBe(0);
    const fee = { feeType: "quadratic", multiplier: 1 };
    // YES ask 4.5¢ (NO bid 95.5¢), P 0.30 → a huge taker edge, still refused in the last minute
    const cheap: Book = { yesBid: { price: 0.04, size: 100 }, noBid: { price: 0.955, size: 100 }, ts: NOW };
    expect(scoreSides(0.3, 0.3, cheap, fee).best?.price).toBeLessThan(0.05);
    const lm = scoreSides(0.3, 0.3, cheap, fee, { allowMaker: true, allowTaker: true, minPrice: minPriceFor(30) });
    expect(lm.all.every((c) => c.price >= 0.05)).toBe(true);
    const calm = { cooling: false, dir: null, z: 0, triggered: false, until: 0 };
    expect(pullReason({ side: "yes", price: 0.045, p: 0.3, failed: null, shock: 0, tte: 30, lockFrac: 0.7, kind: "rti60", guard: calm })).toContain("under 5¢");
  });
});

describe("size to room", () => {
  it("POLICY (aurix-x): budget = min($3, room to −$5, room under $9 exposure); under one contract → skip", async () => {
    const { roomBudget } = await import("./sizing");
    expect(roomBudget(snap())).toBe(3);
    expect(roomBudget(snap({ realizedToday: -2.16 }))).toBeCloseTo(2.84, 6);
    expect(roomBudget(snap({ realizedToday: 5, openWorst: 3, restWorst: 4.5 }))).toBeCloseTo(1.5, 6); // exposure room 1.5 < daily room 2.5
    expect(roomBudget(snap({ realizedToday: -5 }))).toBe(0);
    expect(roomBudget(null)).toBe(0);
    const fee = { feeType: "quadratic", multiplier: 1 };
    const book: Book = { yesBid: { price: 0.6, size: 50 }, noBid: { price: 0.35, size: 50 }, ts: NOW };
    const g = scoreSides(0.7, 0.7, book, fee, { allowMaker: true, allowTaker: true, budget: 1.3 });
    expect(g.best?.count).toBe(2); // 2 × 61¢ = $1.22 ≤ $1.30
    const none = scoreSides(0.7, 0.7, book, fee, { allowMaker: true, allowTaker: true, budget: 0.5 });
    expect(none.best).toBeNull();
    expect(none.failed).toBe("no_room_or_edge");
  });

  it("an order sized to the room passes the unchanged risk check exactly at the edge", async () => {
    const { roomBudget } = await import("./sizing");
    const s = snap({ realizedToday: -2.16 });
    const budget = roomBudget(s);
    const r = new RiskEngine(tmp("room"), ON);
    const count = sizeFor(0.5, true, { feeType: "quadratic", multiplier: 1 }, budget);
    expect(count).toBe(5);
    expect(r.check(intent({ price: 0.5, count }), s, NOW).ok).toBe(true);
    expect(r.check(intent({ price: 0.5, count: count + 1 }), s, NOW).ok).toBe(false);
  });
});

describe("limit orders only", () => {
  it("every order body carries an explicit limit price and a limit time-in-force; no market type exists", () => {
    for (const mode of ["maker", "taker"] as const) {
      for (const side of ["yes", "no"] as const) {
        const b = orderBody(intent({ mode, side, price: 0.37 }), "c");
        expect(typeof b.price).toBe("string");
        expect(Number(b.price)).toBeGreaterThan(0);
        expect(["good_till_canceled", "immediate_or_cancel"]).toContain(b.time_in_force as string);
        expect(b.type).toBeUndefined();
      }
    }
    const SRC = new URL("..", import.meta.url).pathname;
    for (const f of ["desk/oms.ts", "desk/engine.ts", "desk/gate.ts", "scan/kalshi-auth.ts"]) {
      expect(readFileSync(join(SRC, f), "utf8")).not.toMatch(/type:\s*["']market["']|buy_max_cost/);
    }
  });

  it("the OMS refuses a missing/invalid limit price or a fractional count before risk or POST", async () => {
    const dir = tmp("limit");
    const { t, calls } = spyTransport();
    const oms = new Oms(new RiskEngine(dir, ON), t, async () => [], dir);
    for (const bad of [intent({ price: 0 }), intent({ price: 1 }), intent({ price: Number.NaN }), intent({ count: 2.5 }), intent({ count: 0 })]) {
      const r = await oms.submit(bad, snap());
      expect(r.ok).toBe(false);
    }
    expect(calls.length).toBe(0);
  });
});

describe("dated risk override (Sameer t107u) — POLICY (aurix-x): overrides are switched off (ENABLE_RISK_OVERRIDES = false)", () => {
  const START = Date.parse("2026-10-08T11:15:00Z"); // 04:15 PT
  const EXPIRES = Date.parse("2026-10-09T04:00:00Z"); // 00:00 ET Oct 9 = 21:00 PT Oct 8
  const OV = {
    id: "20261008-t107u",
    kind: "fresh_from_start",
    reason: "Sameer t107u",
    created_at: "2026-10-08T10:30:00Z",
    et_day: "2026-10-08",
    start: new Date(START).toISOString(),
    expires: new Date(EXPIRES).toISOString(),
  };
  const setup = () => {
    const dir = tmp("override");
    writeFileSync(join(dir, "risk-override-20261008.json"), JSON.stringify(OV));
    return { dir, r: new RiskEngine(dir, ON) };
  };
  const early = [
    { ticker: "KXSOL15M-26OCT080545-45", pnl: -4.1, settledMs: Date.parse("2026-10-08T10:00:03Z") },
    { ticker: "KXXRP15M-26OCT080600-00", pnl: -4.0, settledMs: Date.parse("2026-10-08T10:15:03Z") },
    { ticker: "KXETH15M-26OCT080615-15", pnl: -4.06, settledMs: Date.parse("2026-10-08T10:15:03.668Z") },
  ];
  const at = (now: number, over: Partial<AccountSnapshot> = {}): AccountSnapshot =>
    snap({ fetchedAt: now, exchangeCheckedAt: now, etDay: etDay(now), realizedToday: -12.16, settledToday: early, ...over });
  const T2 = "KXBTC15M-26OCT081230-30";

  it("the switch is off in config", () => {
    expect(ENABLE_RISK_OVERRIDES).toBe(false);
  });

  it("before and after 04:15 the real P/L counts: no re-base, a $1 order is refused", () => {
    const { r } = setup();
    for (const now of [START - 60_000, START + 1_000, START + 3 * 3600_000]) {
      const s = r.effective(at(now), now);
      expect(s.override).toBeUndefined();
      expect(dayWorstOf(s)).toBeCloseTo(-12.16, 6);
      expect(roomBudgetTop(s)).toBe(0);
      expect(r.check(intent({ ticker: T2, price: 0.5, count: 2 }), at(now), now).ok).toBe(false);
    }
  });

  it("the override file still parses and expires at the ET reset (loader kept for history), but is never applied", async () => {
    const { activeOverride, loadOverrides } = await import("./override");
    const { dir, r } = setup();
    const list = loadOverrides(dir);
    expect(activeOverride(list, START - 1)).toBeNull();
    expect(activeOverride(list, START)?.id).toBe(OV.id);
    expect(activeOverride(list, EXPIRES)).toBeNull();
    const now = START + 1_000;
    const s = at(now);
    expect(r.effective(s, now)).toBe(s);
  });

  it("a latch set before 04:15 is carried past 04:15 for the rest of the ET day; a malformed override file is ignored", async () => {
    const { dir, r } = setup();
    r.latch("old part of the day", START - 600_000);
    expect(r.latched(START - 1)).not.toBeNull();
    expect(r.latched(START + 1)).not.toBeNull();
    const { loadOverrides } = await import("./override");
    writeFileSync(join(dir, "risk-override-20261009.json"), "{not json");
    expect(loadOverrides(dir).length).toBe(1);
  });
});
