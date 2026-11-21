import { afterEach, beforeEach, describe, it } from "node:test";
import { expect } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beatPerpsWorker, pagePerpsStop, perpsSupervisionFresh, perpsWatchdogTick, PERPS_HEARTBEAT_STALE_MS } from "./emergency-control";
import { reconcilePerpsCycle } from "./fill-guardian";
import { FakeExchange, PerpsOms, clientOrderId, toCreateReq, type Intent } from "./oms";
import { liveMarginTransport } from "./live-transport";
import { mapMarginOrder, readMarginArray } from "./margin-wire";
import { perpsReader } from "./kalshi-perps-read";

const entry: Intent = { kind: "entry", ticker: "TEST", dir: "long", qty: 2, price: 100, maker: false, decisionId: "first",
  plan: { dir: "long", qty: 2, entry: 100, stop: 99, t1: 101, t2: 102, partialFrac: 0.5, trailR: 1, maxHoldMs: 60_000 } };
const quotes = { TEST: { bestBid: 99, bestAsk: 101 } };
const healthy = () => ({ ok: true, why: "test fixture" });
function gate() {
  let open!: () => void;
  const wait = new Promise<void>(resolve => { open = resolve; });
  return { wait, open };
}

describe("perps emergency stop against an isolated venue", () => {
  let root: string, journal: string, venue: FakeExchange, oms: PerpsOms;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "perps-stop-"));
    journal = join(root, "oms.jsonl");
    writeFileSync(journal, "");
    venue = new FakeExchange();
    oms = new PerpsOms(venue, journal, true, healthy);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("drains an entry already in flight at another manager, then flattens the venue (#27, #28, #31)", async () => {
    const send = venue.createOrder.bind(venue), pending = gate();
    venue.createOrder = async req => { if (!req.reduce_only) await pending.wait; return send(req); };
    const submission = oms.submit(entry);
    const killer = new PerpsOms(venue, journal, true, healthy);
    const stopped = killer.killAndFlatten("operator", "operator", quotes, "stop");
    try {
      expect(existsSync(journal + ".kill")).toBe(true);
      expect((await oms.submit({ ...entry, decisionId: "later" })).status).toContain("BLOCKED");
      expect(venue.orders).toHaveLength(0);
    } finally { pending.open(); }
    await submission;
    expect(await stopped).toMatchObject({ ok: true, state: "FLAT" });
    expect(venue.orders.map(o => !!o.reduce_only)).toEqual([false, true]);
    expect((await venue.positions())[0].position).toBe("0");
    expect(venue.triggers).toHaveLength(0);
    expect((await new PerpsOms(venue, journal, true, healthy).submit(entry)).status).toContain("BLOCKED");
  });

  it("alerts on a bounded drain timeout and retains protection even if the entry lands later", async () => {
    const pending = gate(), send = venue.createOrder.bind(venue);
    venue.createOrder = async req => { await pending.wait; return send(req); };
    venue.triggers.push({ ticker: "OTHER", body: { stop_loss_price: "95" } });
    let cancels = 0, reads = 0;
    const positions = venue.positions.bind(venue);
    venue.cancelAll = async () => { cancels++; };
    venue.positions = async () => { reads++; return positions(); };
    const submission = oms.submit(entry);
    const killer = new PerpsOms(venue, journal, true, healthy, 40);
    try {
      expect(await killer.killAndFlatten("op", "op", quotes, "timeout")).toMatchObject({ ok: false, state: "UNKNOWN" });
      expect(cancels).toBe(0); expect(reads).toBe(0);
      expect(venue.triggers).toHaveLength(1);
      expect(readFileSync(journal + ".alerts.jsonl", "utf8")).toContain("did not drain");
    } finally { pending.open(); }
    await submission;
    expect((await positions())[0].position).toBe("2");
    expect((await oms.submit({ ...entry, decisionId: "again" })).status).toContain("BLOCKED");
  });

  it("keeps a lost reply UNKNOWN when absent, then adopts the matching client ID without resending (#20)", async () => {
    const send = venue.createOrder.bind(venue);
    venue.createOrder = async () => { throw new Error("lost reply"); };
    expect((await oms.submit(entry)).status).toContain("UNKNOWN");
    const restarted = new PerpsOms(venue, journal, true, healthy);
    expect((await restarted.reconcile(0)).missing).toEqual([clientOrderId(entry)]);
    expect(restarted.stateOf(clientOrderId(entry))).toBe("UNKNOWN");
    expect(await restarted.killAndFlatten("op", "op", quotes, "unknown")).toMatchObject({ state: "UNKNOWN" });
    venue.createOrder = send;
    await send(toCreateReq(entry)); // delayed venue acceptance of the original request
    expect((await restarted.reconcile(0)).resolved).toEqual([clientOrderId(entry)]);
    expect(await restarted.killAndFlatten("op", "op", quotes, "retry")).toMatchObject({ ok: true, state: "FLAT" });
    expect(venue.orders.filter(o => !o.reduce_only)).toHaveLength(1);
  });

  it("resolves a journal left at SENT after a crash, with no second entry (#20)", async () => {
    const cid = clientOrderId(entry), at = new Date().toISOString();
    writeFileSync(journal, [ { at, cid, state: "INTENT", intent: entry }, { at, cid, state: "SENT" } ].map(r => JSON.stringify(r)).join("\n") + "\n");
    await venue.createOrder(toCreateReq(entry));
    const restart = new PerpsOms(venue, journal, true, healthy);
    expect((await restart.reconcile(0)).resolved).toEqual([cid]);
    expect((await restart.submit(entry)).status).toContain("DUPLICATE");
    expect(venue.orders).toHaveLength(1);
  });

  it("drains a dead writer's lease using its persisted client ID and the venue receipt", async () => {
    const source = [
      'import { FakeExchange, PerpsOms } from "./src/lib/perps/oms";',
      'const venue = new FakeExchange();',
      'venue.createOrder = async () => { process.stdout.write("sent\\n"); await new Promise(() => {}); };',
      'setInterval(() => {}, 60_000);',
      'await new PerpsOms(venue, process.env.TEST_JOURNAL, true, () => ({ok:true, why:"test"})).submit(JSON.parse(process.env.TEST_INTENT));',
    ].join("\n");
    const child = spawn(process.execPath, ["-e", source], {
      env: { ...process.env, TEST_JOURNAL: journal, TEST_INTENT: JSON.stringify(entry) }, stdio: ["ignore", "pipe", "ignore"],
    });
    try {
      await once(child.stdout!, "data");
      // The exchange accepted the request; the writer dies before receiving the ACK.
      await venue.createOrder(toCreateReq(entry));
    } finally { child.kill("SIGKILL"); await once(child, "exit"); }
    const restart = new PerpsOms(venue, journal, true, healthy, 300);
    expect((await restart.reconcile(0)).resolved).toEqual([clientOrderId(entry)]);
    expect(await restart.killAndFlatten("op", "op", quotes, "crash")).toMatchObject({ ok: true, state: "FLAT" });
    expect(venue.orders.filter(o => !o.reduce_only)).toHaveLength(1);
  });

  it("refuses a flat venue read that contradicts an acknowledged fill", async () => {
    await oms.submit(entry);
    venue.positions = async () => [];
    const r = await oms.killAndFlatten("op", "op", quotes, "contradiction");
    expect(r).toMatchObject({ ok: false, state: "UNKNOWN" });
    expect(venue.triggers.length).toBeGreaterThan(0);
  });

  it("retains triggers on partial IOC, a passed-through resting order, or a failed position read", async () => {
    await oms.submit({ ...entry, maker: true });
    const cancel = venue.cancelAll.bind(venue);
    venue.cancelAll = async () => {};
    expect(await oms.killAndFlatten("op","op",quotes,"still-resting")).toMatchObject({state:"UNKNOWN"});
    venue.cancelAll = cancel;
    const read = venue.positions.bind(venue);
    venue.positions = async () => { throw new Error("read failed"); };
    expect(await oms.killAndFlatten("op","op",quotes,"no-read")).toMatchObject({state:"UNKNOWN"});
    venue.positions = read;
    venue.applyFill("manual", entry.ticker, "bid", 2, 100, true);
    const create = venue.createOrder.bind(venue);
    venue.createOrder = req => create({ ...req, count: "1" });
    expect(await oms.killAndFlatten("op","op",quotes,"partial")).toMatchObject({state:"UNKNOWN"});
    expect(venue.triggers.length).toBeGreaterThan(0);
    expect((await read())[0].position).toBe("1");
  });

  it("clears stale brackets after verified flat even if zero-position tickers disappear", async () => {
    await oms.submit({ ...entry, maker: true });
    expect((await venue.positions())).toEqual([]);
    expect(venue.triggers.length).toBeGreaterThan(0);
    expect(await oms.killAndFlatten("op", "op", quotes, "resting")).toMatchObject({ state: "FLAT" });
    expect(venue.triggers).toHaveLength(0);
  });

  it("an operator can latch the desk from a second process while the worker is wedged (#29)", async () => {
    const child = spawn(process.execPath, ["-e", 'process.stdout.write("wedged\\n"); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);'], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      await once(child.stdout!, "data");
      const tool = new URL("../../../scripts/perps/watchdog.ts", import.meta.url).pathname;
      const result = spawnSync(process.execPath, [tool, "--kill"], { env: { ...process.env, MACROMIRO_PERPS_JOURNAL: journal }, timeout: 2_000 });
      expect(result.status).toBe(2);
      expect(existsSync(journal + ".kill")).toBe(true);
      expect((await oms.submit(entry)).status).toContain("BLOCKED");
    } finally { child.kill("SIGKILL"); await once(child, "exit"); }
  });

  it("a lost heartbeat latches until review even if a fresh heartbeat appears (#30, #31)", async () => {
    const now = Date.now();
    beatPerpsWorker(journal, now);
    expect(perpsSupervisionFresh(journal, now)).toBe(false);
    expect(perpsWatchdogTick(journal, now).ok).toBe(true);
    expect(perpsSupervisionFresh(journal, now)).toBe(true);
    expect(perpsWatchdogTick(journal, now + PERPS_HEARTBEAT_STALE_MS).ok).toBe(false);
    beatPerpsWorker(journal);
    expect(perpsWatchdogTick(journal).ok).toBe(false);
    expect((await oms.submit(entry)).status).toContain("BLOCKED");
  });

  it("reconciles owned fills each cycle and latches on divergence, including absent venue positions", async () => {
    await oms.submit(entry);
    expect(await reconcilePerpsCycle(oms, venue, journal)).toMatchObject({ status: "OK", verified: 1, openPositions: 1 });
    const lastGood = readFileSync(journal + ".heartbeat", "utf8");
    venue.positions = async () => [];
    expect(await reconcilePerpsCycle(oms, venue, journal)).toMatchObject({ status: "INCIDENT", openPositions: null });
    expect(readFileSync(journal + ".heartbeat", "utf8")).toBe(lastGood);
    expect((await oms.submit({ ...entry, decisionId: "next" })).status).toContain("BLOCKED");
  });

  it("retries a failed operator page and deduplicates a delivered alert using the same incident ID", async () => {
    perpsWatchdogTick(journal);
    const keys: string[] = [];
    const send: typeof fetch = async (_url, init) => {
      keys.push(new Headers(init?.headers).get("Idempotency-Key")!);
      return new Response(null, { status: keys.length === 1 ? 503 : 204 });
    };
    const url = "https://alerts.test/operator";
    await expect(pagePerpsStop(journal, url, send)).rejects.toThrow("503");
    await pagePerpsStop(journal, url, send);
    await pagePerpsStop(journal, url, send);
    expect(keys.length).toBe(2); expect(keys[0]).toBe(keys[1]);
  });

  it("blocks live entry writes before signing and rejects incomplete venue evidence", async () => {
    await expect(liveMarginTransport.createOrder(toCreateReq(entry))).rejects.toThrow("LOCKED");
    await expect(readMarginArray("/unused", "positions", async () => ({ status: 200, body: { positions: [], cursor:"more" } }))).rejects.toThrow("incomplete");
    expect(() => mapMarginOrder({order_id:"a", side:"bid", fill_count:"0"})).toThrow("remaining_count");
    expect(await perpsReader(async () => ({ enabled:"false" })).enabled()).toBe(false);
  });

  it("routes the ticker socket to demo only after the eligibility check succeeds", () => {
    const source = [
      'let enabled = false; const result = []; let opened;',
      'const connect = url => {result.push(url); return {on(e,f){if(e==="open")opened=f}, send(x){result.push(JSON.parse(x).params.channels)}}};',
      'const {ensurePerpSocket} = await import("./src/lib/skill/perp-socket.server");',
      'ensurePerpSocket(connect, async()=>enabled); await Bun.sleep(1); result.push(result.length); enabled=true;',
      'ensurePerpSocket(connect, async()=>enabled); await Bun.sleep(1); opened(); console.log(JSON.stringify(result));',
    ].join("\n");
    const result = spawnSync(process.execPath, ["-e", source], { env: { ...process.env, KALSHI_PERPS_ENV: "demo" }, encoding: "utf8", timeout: 2_000 });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([0, "wss://external-api-margin-ws.demo.kalshi.co/trade-api/ws/v2/margin", ["ticker"]]);
  });
});
