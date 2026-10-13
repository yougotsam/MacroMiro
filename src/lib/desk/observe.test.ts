import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Collector, executableQuote, parseLevels, type ObserveDeps } from "./observe";
import { Feeds } from "./feeds";
import { MoveGuard } from "./guard";
import type { Market } from "./kalshi-read";

const SRC = resolve(new URL("../..", import.meta.url).pathname);
const ROOT = resolve(SRC, "..");
function graph(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (f: string) => {
    if (seen.has(f) || !existsSync(f)) return;
    seen.add(f);
    for (const m of readFileSync(f, "utf8").matchAll(/(?:import|export)\s([^"']*?)from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g)) {
      if (m[1]?.startsWith("type ")) continue; // type-only imports carry no code
      const spec = m[2] ?? m[3];
      const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(f), spec) : null;
      if (!base) continue;
      const hit = [`${base}.ts`, `${base}.tsx`, base].find((c) => existsSync(c) && /\.tsx?$/.test(c));
      if (hit) visit(hit);
    }
  };
  visit(entry);
  return [...seen].map((x) => x.slice(ROOT.length + 1));
}

describe("collector is provably unable to post orders", () => {
  const g = graph(join(ROOT, "scripts/desk-observe.ts"));
  it("its import graph is non-trivial but never reaches the OMS, the engine or the order transport", () => {
    for (const f of ["src/lib/desk/observe.ts", "src/lib/desk/evaluator.ts", "src/lib/desk/feeds.ts", "src/lib/desk/net-guard.ts"]) expect(g).toContain(f);
    for (const f of ["src/lib/desk/oms.ts", "src/lib/desk/engine.ts", "src/lib/desk/risk.ts"]) expect(g).not.toContain(f);
    for (const f of g) {
      const t = readFileSync(join(ROOT, f), "utf8");
      expect({ f, post: /kalshiOrderPost|ORDER_PATH|portfolio\/events\/orders|method:\s*"POST"/.test(t) }).toEqual({ f, post: false });
      if (f !== "src/lib/scan/kalshi-auth.ts") expect({ f, del: /kalshiDelete\(|method:\s*"DELETE"/.test(t) }).toEqual({ f, del: false });
    }
  });
  it("the entry installs the GET-only guard before any other statement and refuses the engine's data dir", () => {
    const s = readFileSync(join(ROOT, "scripts/desk-observe.ts"), "utf8");
    const body = s.slice(s.lastIndexOf("import ")).split("\n").slice(1).join("\n");
    expect(body.trim().split("\n").find((l) => l.trim() && !l.trim().startsWith("//"))).toBe("const net = installReadOnlyFetch();");
    expect(s).toContain('dir === "/workspace/data/desk"');
  });
  it("the settlement websocket only ever sends subscribe commands", () => {
    const f = readFileSync(join(SRC, "lib/desk/feeds.ts"), "utf8");
    const sends = [...f.matchAll(/ws\.send\(JSON\.stringify\(\{[^}]*cmd: "([a-z_]+)"/g)].map((m) => m[1]);
    expect(sends.length).toBeGreaterThan(0);
    expect(new Set(sends)).toEqual(new Set(["subscribe"]));
  });
});

describe("executable quotes and depth", () => {
  it("bids-only books → asks with the opposite side's displayed size; best-first levels", () => {
    const l = parseLevels({ orderbook_fp: { yes_dollars: [["0.3000", "5.00"], ["0.4100", "12.00"]], no_dollars: [["0.5500", "7.00"], ["0.0000", "3"]] } });
    expect(l.yes[0]).toEqual({ price: 0.41, size: 12 });
    expect(l.no.length).toBe(1);
    expect(executableQuote(l)).toEqual({ yes_bid: 0.41, yes_bid_size: 12, yes_ask: 0.45, yes_ask_size: 7, no_bid: 0.55, no_bid_size: 7, no_ask: 0.59, no_ask_size: 12, complete: true });
    expect(executableQuote(parseLevels({ orderbook_fp: { yes_dollars: [["0.41", "1"]] } })).complete).toBe(false);
  });
});

describe("collector loop with mocked feeds (no network)", () => {
  const close = Date.now() + 10 * 60_000;
  const mk = (s: string): Market => ({ ticker: `${s}-26OCT091200-00`, series: s, eventTicker: `${s}-26OCT091200`, openMs: close - 900_000, closeMs: close, strike: 100, status: "active", exchangeIndex: 2, strikeType: "greater_or_equal", rules: "CF Benchmarks BRTI ETHUSDRTI SOLUSDRTI XRPUSDRTI gold", priceRanges: [{ start: 0, end: 1, step: 0.01 }] });
  const deps = (over: Partial<ObserveDeps> = {}): ObserveDeps => ({
    openMarket: async (s) => mk(s),
    orderbookRaw: async () => ({ orderbook_fp: { yes_dollars: [["0.40", "10"]], no_dollars: [["0.55", "8"]] } }),
    eventFee: async () => ({ feeType: "quadratic", multiplier: 1 }),
    exchangeStatus: async () => ({ tradingActive: true }),
    marketResult: async () => ({ result: "yes", value: 101.2, status: "finalized" }),
    candles: async () => [],
    trades: async () => [],
    ...over,
  });
  it("writes one observation per series with its exact failed gate, quotes, depth and fee; counts complete quotes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "obs-"));
    const c = new Collector(dir, new Feeds(false), new MoveGuard(), deps());
    await c.tick();
    const f = readdirSync(dir).find((x) => x.startsWith("observations-"))!;
    const rows = readFileSync(join(dir, f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(rows.length).toBe(5);
    for (const r of rows) {
      expect(r.failed_gate).toBe("G1_index_stale"); // no index prints in this test → rejected with the exact gate
      expect(r.rejected).toBe(true);
      expect(r.exec).toMatchObject({ yes_ask: 0.45, yes_ask_size: 8, no_ask: 0.6, no_ask_size: 10, complete: true });
      expect(r.fee_multiplier).toBe(1);
      expect(r.threshold.strike).toBe(100);
      expect(r.expiry_bucket).toBe("5-10m");
    }
    expect(c.status.completeQuoteTickers).toBe(5);
    expect(c.status.failedGates.G1_index_stale).toBe(5);
  });
  it("a missing fee or one-sided book is not a complete executable quote", async () => {
    const dir = mkdtempSync(join(tmpdir(), "obs2-"));
    const c = new Collector(dir, new Feeds(false), new MoveGuard(), deps({ eventFee: async () => { throw new Error("down"); }, orderbookRaw: async () => ({ orderbook_fp: { yes_dollars: [["0.40", "10"]] } }) }));
    await c.tick();
    expect(c.status.completeQuoteTickers).toBe(0);
    expect(c.status.uniqueTickers).toBe(5);
  });
  it("after close it records Kalshi's published result and expiration value once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "obs3-"));
    const c = new Collector(dir, new Feeds(false), new MoveGuard(), deps());
    await c.tick(Date.now());
    await c.tick(close + 60_000);
    await c.tick(close + 120_000);
    const f = readdirSync(dir).filter((x) => x.startsWith("outcomes-"));
    const rows = f.flatMap((x) => readFileSync(join(dir, x), "utf8").trim().split("\n")).map((l) => JSON.parse(l));
    expect(rows.length).toBe(5);
    expect(rows[0]).toMatchObject({ result: "yes", value: 101.2 });
  });
  it("indicators: gold has no traded-volume source → volume/flow features reported unavailable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "obs4-"));
    const c = new Collector(dir, new Feeds(false), new MoveGuard(), deps());
    await c.indicators();
    expect(c.status.indicators.KXGOLD15M.unavailable.vwap).toContain("no traded-volume source");
    expect(c.status.indicators.KXGOLD15M.unavailable.cvd).toContain("no signed");
    expect(c.status.indicators.KXBTC15M.unavailable.ema7).toContain("needs 7 bars");
  });
});
