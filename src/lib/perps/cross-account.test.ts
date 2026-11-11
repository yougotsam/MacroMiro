import { expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCrossAccountTransport, scopedClientOrderId, type CrossScope, type Request } from "./cross-account";
import { PerpsOms, clientOrderId, toCreateReq, type Intent } from "./oms";
import { runAccountRead } from "../../../scripts/perps/account-read-core";
const scope: CrossScope = { origin: "https://fixture.invalid", subaccount: 7, subaccount_type: "cross" };
const intent: Intent = { kind: "entry", ticker: "SAME", dir: "long", qty: 2, price: 100, maker: true, decisionId: "fixture", plan: {
  dir: "long", qty: 2, entry: 100, stop: 99, t1: 101, t2: 102, partialFrac: 0.5, trailR: 1, maxHoldMs: 3600000,
} };
function position(subaccount: number, q: number) {
  return { market_ticker: "SAME", subaccount, subaccount_type: "cross", position: q.toFixed(2), entry_price: "100.000000", unrealized_pnl: "0.000000", fees: "0.000000" };
}
function bracket(extra: Record<string, unknown> = {}) {
  return { id: "trg1", ticker: "SAME", kind: "bracket", status: "active", count: "0.00", filled_count: "0.00",
    created_time: new Date(0).toISOString(), updated_time: new Date(0).toISOString(), ...extra };
}
function harness() {
  const requests: Request[] = [];
  let positions: Record<string, unknown>[] = [position(7, 0), position(8, 99)];
  const orders: { account: number; raw: Record<string, unknown> }[] = [];
  let triggers: Record<string, unknown>[] = [];
  let onRead: ((request: Request) => void) | undefined;
  let onWrite: ((request: Request) => void) | undefined;
  const io = {
    read: async (request: Request & { method: "GET" }) => {
      requests.push(request); onRead?.(request);
      const url = new URL(request.url), account = Number(url.searchParams.get("subaccount"));
      if (url.pathname.endsWith("/exit_trigger")) return { status: 200, body: { exit_triggers: account === 7 ? triggers : [] } };
      if (url.pathname.endsWith("/positions")) return { status: 200, body: { positions } };
      if (url.pathname.endsWith("/fills")) return { status: 200, body: { fills: [], cursor: "" } };
      return { status: 200, body: { orders: orders.filter((o) => o.account === account).map((o) => o.raw), cursor: "" } };
    },
    write: async (request: Request) => {
      requests.push(request); onWrite?.(request);
      const url = new URL(request.url), body = request.body ? JSON.parse(request.body) : null;
      if (request.method === "POST") {
        const account = body.subaccount;
        const closing = body.reduce_only === true;
        const id = `order-${orders.length + 1}`;
        orders.push({ account, raw: { order_id: id, user_id: "fixture-user", client_order_id: body.client_order_id,
          ticker: body.ticker, side: body.side, price: body.price, fill_count: closing ? Number(body.count).toFixed(2) : "0.00", remaining_count: closing ? "0.00" : Number(body.count).toFixed(2),
          last_update_reason: "", created_time: null, order_source: "user" } });
        if (closing) positions = positions.map((p) => p.subaccount === account ? { ...p, position: "0.00" } : p);
        return { status: 201, body: { order_id: id, fill_count: closing ? Number(body.count).toFixed(2) : "0.00", remaining_count: closing ? "0.00" : Number(body.count).toFixed(2) } };
      }
      if (request.method === "PUT") {
        triggers = [bracket({ ...body, ticker: decodeURIComponent(url.pathname.split("/")[6]!), status: "pending_on_entry" })];
        return { status: 200, body: triggers[0] };
      }
      if (url.pathname.endsWith("exit_trigger")) triggers = [];
      return { status: 204, body: null };
    },
  };
  return { io, requests, orders, get positions() { return positions; }, set positions(p) { positions = p; },
    get triggers() { return triggers; }, set triggers(t) { triggers = t; },
    set onRead(f: ((r: Request) => void) | undefined) { onRead = f; },
    set onWrite(f: ((r: Request) => void) | undefined) { onWrite = f; },
  };
}
function oms(h: ReturnType<typeof harness>, journal: string | null = join(mkdtempSync(join(tmpdir(), "cross-test-")), "journal.jsonl"), allow = true) {
  const t = createCrossAccountTransport(scope, h.io);
  return { t, oms: new PerpsOms(t, journal, allow, () => ({ ok: true, why: "fixture" })) };
}
it("scoped v2 identity is stable/separate; legacy identity and request bytes unchanged", () => {
  expect(scopedClientOrderId(scope, intent)).toBe(scopedClientOrderId({ ...scope }, intent));
  expect(scopedClientOrderId(scope, intent)).not.toBe(scopedClientOrderId({ ...scope, subaccount: 8 }, intent));
  expect(scopedClientOrderId(scope, intent)).not.toBe(scopedClientOrderId({ ...scope, origin: "https://other.invalid" }, intent));
  expect(scopedClientOrderId(scope, intent).startsWith("mm-perps-v2-")).toBe(true);
  expect(clientOrderId(intent).startsWith("mm-perps-")).toBe(true);
  expect(toCreateReq(intent).client_order_id).toBe(clientOrderId(intent));
  expect(Object.hasOwn(toCreateReq(intent), "subaccount")).toBe(false);
});
it("persists exact intended URL/body before dispatch; official ACK does not echo account", async () => {
  const h = harness();
  const journal = join(mkdtempSync(join(tmpdir(), "cross-journal-")), "journal.jsonl");
  h.onWrite = (request) => {
    if (request.method !== "POST") return;
    const rows = readFileSync(journal, "utf8").trim().split("\n").map((s) => JSON.parse(s));
    const row = rows.find((r) => r.state === "INTENT");
    expect(row.intendedRouting).toEqual(scope);
    expect(row.serializedRequest).toEqual(request);
    expect(rows.at(-1).state).toBe("SENT");
    expect(JSON.parse(request.body!).subaccount).toBe(7);
    expect(Object.isFrozen(request)).toBe(true);
  };
  const { oms: manager } = oms(h, journal);
  expect((await manager.submit(intent)).status).toBe("ACK");
  expect(manager.rows.find((r) => r.state === "ACK")?.intendedRouting).toEqual(scope);
  expect(manager.rows.some((r) => "routingVerified" in r || "ownership" in r)).toBe(false);
});
it("actual partial fill, further fill, bracket readback, exit and restart use one generic scoped OMS", async () => {
  const h = harness(), journal = join(mkdtempSync(join(tmpdir(), "cross-flow-")), "journal.jsonl");
  const { oms: manager, t } = oms(h, journal);
  const entry = await manager.submit(intent);
  h.positions = [position(7, 1), position(8, 99)];
  h.orders[0]!.raw.fill_count = "1.00"; h.orders[0]!.raw.remaining_count = "1.00";
  h.triggers = [bracket({ id: "trg1", kind: "bracket", status: "active", count: "0.00", stop_loss_price: "99.0000", take_profit_price: "102.0000" })];
  expect((await manager.ensureAfterFill(intent, entry.order_id!)).state).toBe("PROTECTION_VERIFIED");
  h.positions = [position(7, 2), position(8, 99)]; h.orders[0]!.raw.fill_count = "2.00"; h.orders[0]!.raw.remaining_count = "0.00";
  const restarted = new PerpsOms(t, journal, false);
  const audit = await restarted.recover(0);
  expect(audit.protection[0]?.state).toBe("BRACKET_SNAPSHOT_VERIFIED");
  expect(audit.blocked).toContain("lifecycle");
  const exit: Intent = { ...intent, kind: "exit", maker: false, plan: undefined, decisionId: "exit" };
  expect((await manager.submit(exit)).status).toBe("ACK");
  expect(h.positions.find((p) => p.subaccount === 7)?.position).toBe("0.00");
  expect(h.positions.find((p) => p.subaccount === 8)?.position).toBe("99.00");
  const writes = h.requests.filter((r) => r.method !== "GET");
  expect(writes.every((r) => r.method === "POST" ? JSON.parse(r.body!).subaccount === 7 : new URL(r.url).searchParams.get("subaccount") === "7")).toBe(true);
  const posts = writes.filter((r) => r.method === "POST").length;
  await manager.submit(intent);
  expect(h.requests.filter((r) => r.method === "POST")).toHaveLength(posts);
});
it("readback growth does not verify a partial bracket or clear prior lifecycle failure", async () => {
  const h = harness(); const { oms: manager } = oms(h);
  const entry = await manager.submit(intent);
  h.positions = [position(7, 1), position(8, 99)];
  h.triggers = [bracket({ id: "trg1", kind: "bracket", status: "active", count: "1.00", stop_loss_price: "99.0000", take_profit_price: "102.0000" })];
  let reads = 0;
  h.onRead = (r) => { if (r.url.includes("exit_trigger") && ++reads === 2) h.positions = [position(7, 2), position(8, 99)]; };
  manager.blocked = "ownership lifecycle unverified: SAME";
  expect((await manager.ensureAfterFill(intent, entry.order_id!)).state).toBe("PROTECTION_FAILED");
  expect(manager.blocked).toBe("ownership lifecycle unverified: SAME");
  h.onRead = undefined; h.triggers[0]!.count = "0.00";
  expect((await manager.ensureAfterFill(intent, entry.order_id!)).state).toBe("PROTECTION_VERIFIED");
  expect(manager.stateOf(entry.cid)).toBe("PROTECTION_FAILED");
  expect(manager.blocked).toBe("ownership lifecycle unverified: SAME");
});
it("missing WriteIO rejects every mutation before any IO; allowSend false also performs no read", async () => {
  let calls = 0;
  const t = createCrossAccountTransport(scope, { read: async () => { calls++; throw new Error("unexpected read"); } });
  const req = { ...toCreateReq(intent), client_order_id: scopedClientOrderId(scope, intent), subaccount: 7 };
  for (const operation of [() => t.createOrder(req), () => t.cancelOrder("unknown"), () => t.cancelAll(),
    () => t.setCrossExitTrigger("SAME", {}), () => t.updateCrossExitTrigger("SAME", "trg1", {}), () => t.cancelCrossExitTriggers("SAME")]) {
    await expect(operation()).rejects.toThrow("scoped writes unavailable");
  }
  const manager = new PerpsOms(t, null, true);
  expect((await manager.submit(intent)).status).toContain("LOCKED");
  expect((await manager.killAndFlatten("x", "x", {}, "kill")).ok).toBe(false);
  expect(calls).toBe(0);
  const h = harness(), closed = oms(h, null, false).oms;
  expect((await closed.submit(intent)).status).toContain("LOCKED");
  expect(h.requests).toHaveLength(0);
});
it("prepared request cannot be forged, mutated or scope-overridden", async () => {
  const h = harness(), { t } = oms(h);
  const req = { ...toCreateReq(intent), client_order_id: scopedClientOrderId(scope, intent), subaccount: 7 };
  expect(() => t.prepareCreate({ ...req, subaccount: 8 })).toThrow("mismatch");
  const prepared = t.prepareCreate(req);
  expect(Reflect.set(prepared, "body", "{}")).toBe(false);
  await expect(t.dispatchCreate({ ...prepared, url: "https://other.invalid" })).rejects.toThrow("unissued");
  expect(h.requests).toHaveLength(0);
});
it("projects only reported matching account/type; missing or duplicate identity fails closed", async () => {
  const h = harness(), { t } = oms(h);
  expect((await t.positions()).map((p) => p.position)).toEqual(["0.00"]);
  h.positions = [position(7, 1), { ...position(7, 2), subaccount_type: "isolated" }];
  expect((await t.positions()).map((p) => p.position)).toEqual(["1.00"]);
  h.positions = [position(7, 1), position(7, 2)];
  await expect(t.positions()).rejects.toThrow("ambiguous");
  h.positions = [{ ...position(7, 1), subaccount_type: null }];
  await expect(t.positions()).rejects.toThrow("scope unknown");
});
it("cancel requires known association AND filtered REST evidence; single cancel and cancel-all include account query", async () => {
  const h = harness(), { t, oms: manager } = oms(h);
  await expect(t.cancelOrder("external")).rejects.toThrow("unknown scoped");
  const entry = await manager.submit(intent);
  await t.cancelOrder(entry.order_id!); await t.cancelAll();
  expect(h.requests.filter((r) => r.method === "DELETE").every((r) => new URL(r.url).searchParams.get("subaccount") === "7")).toBe(true);
  h.orders[0]!.raw.order_source = "system";
  await expect(t.cancelOrder(entry.order_id!)).rejects.toThrow("unverified");
});
it("all cursor pages retain account selector; history failure is not an empty account", async () => {
  const paths: string[] = [];
  const t = createCrossAccountTransport(scope, { read: async (request) => {
    paths.push(request.url); return { status: 200, body: { orders: [], cursor: paths.length === 1 ? "next" : "" } };
  } });
  expect(await t.listOrders({})).toEqual([]);
  expect(paths).toHaveLength(2);
  expect(paths.every((p) => new URL(p).searchParams.get("subaccount") === "7")).toBe(true);
  const bad = createCrossAccountTransport(scope, { read: async () => ({ status: 500, body: {} }) });
  await expect(bad.listOrders({})).rejects.toThrow();
});
it("legacy/conflicting journals are not migrated and missing scoped history stays unknown", async () => {
  const h = harness(), file = join(mkdtempSync(join(tmpdir(), "cross-legacy-")), "journal.jsonl");
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), cid: clientOrderId(intent), state: "INTENT", intent }) + "\n");
  const { t } = oms(h);
  const manager = new PerpsOms(t, file, false);
  expect(manager.blocked).toContain("unowned legacy");
  const before = readFileSync(file, "utf8");
  await manager.recover(0);
  expect(readFileSync(file, "utf8")).toBe(before);
});
it("account diagnostic consumes same generic read side and labels serialized intent without ownership", async () => {
  const h = harness(), file = join(mkdtempSync(join(tmpdir(), "cross-diag-")), "journal.jsonl");
  const { t, oms: manager } = oms(h, file);
  await manager.submit(intent);
  const result = await runAccountRead(["--subaccount", "7", "--subaccount-type", "cross", "--journal", "fixture"], {
    readJournal: async () => readFileSync(file, "utf8"),
    loadReads: async () => ({ sourceOrigin: scope.origin, positions: async () => h.positions,
      orders: async () => h.orders.map((o) => o.raw), fills: async () => [] }),
    loadRequestEvidence: (_selection, tickers) => t.readEvidence(tickers),
  });
  expect(result.requestScopedOrders[0]?.correlation).toBe("exact-order-id-and-cid");
  expect(result.journal?.find((r) => r.value && (r.value as { state: string }).state === "INTENT")?.intendedRoutingEvidence).toBe("serialized-intent");
  expect(result.routingVerified).toBe(false); expect(result.lifecycleReady).toBe(false);
  expect(result.inventory.other).toHaveLength(1);
});
it("every trigger variant and fill query carry actual account selector", async () => {
  const h = harness(), { t } = oms(h);
  await t.fills({ min_ts: 1 });
  await t.getCrossExitTriggers("SAME/slash");
  await t.setCrossExitTrigger("SAME/slash", { kind: "bracket", stop_loss_price: "99.0000" });
  await t.updateCrossExitTrigger("SAME/slash", "trg1", { stop_loss_price: "99.5000" });
  await t.cancelCrossExitTriggers("SAME/slash");
  expect(h.requests.every((r) => new URL(r.url).searchParams.get("subaccount") === "7")).toBe(true);
  expect(h.requests.filter((r) => r.url.includes("exit_trigger")).every((r) => r.url.includes("SAME%2Fslash"))).toBe(true);
});
it("scoped kill remains closed without lifecycle-owned cleanup sequencing", async () => {
  const h=harness(); h.positions=[position(7,2),position(8,99)]; h.triggers=[bracket()];
  const manager=oms(h).oms;
  expect((await manager.killAndFlatten("x","x",{},"kill")).ok).toBe(false);
  expect(manager.blocked).toContain("KILL"); expect(h.requests).toEqual([]);
  expect(h.triggers).toHaveLength(1); expect(h.positions[0]!.position).toBe("2.00");
});
it("scoped kill does not reach failing readers/writers or fall back", async () => {
  const t=createCrossAccountTransport(scope,{read:async()=>{throw Error("must not read");},write:async()=>{throw Error("must not write");}});
  const manager=new PerpsOms(t,null,true);
  expect((await manager.killAndFlatten("x","x",{},"kill")).ok).toBe(false);
});
it("a durable protection failure cannot be hidden by later rows or bracket snapshots after restart", async () => {
  const h = harness(), file = join(mkdtempSync(join(tmpdir(), "cross-durable-")), "journal.jsonl");
  const { oms: manager, t } = oms(h, file);
  const entry = await manager.submit(intent);
  h.positions = [position(7, 1), position(8, 99)];
  h.triggers = [bracket({ id: "trg1", kind: "bracket", status: "failed", count: "0.00" })];
  await manager.ensureAfterFill(intent, entry.order_id!);
  const rows = [...manager.rows, { at: new Date().toISOString(), cid: entry.cid, state: "RECONCILED", order_id: entry.order_id, intendedRouting: scope }];
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const restarted = new PerpsOms(t, file, false);
  expect(restarted.blocked).toContain("protection");
  h.triggers = [bracket({ id: "trg1", kind: "bracket", status: "active", count: "0.00", stop_loss_price: "99.0000", take_profit_price: "102.0000" })];
  const before = restarted.blocked;
  await restarted.ensureAfterFill(intent, entry.order_id!);
  expect(restarted.blocked).toBe(before);
});
it("reconnect missing history stays UNKNOWN rather than invented cancellation", async () => {
  const h = harness(), { oms: manager } = oms(h);
  const entry = await manager.submit(intent);
  manager.rows.push({ at: new Date().toISOString(), cid: entry.cid, state: "UNKNOWN", intendedRouting: scope });
  h.orders.length = 0;
  await manager.reconcile(0);
  expect(manager.stateOf(entry.cid)).toBe("UNKNOWN");
  expect(manager.blocked).toContain("unknown scoped");
});
it("read-only capability cannot be activated by mutating the original IO holder", async () => {
  const h = harness();
  const holder: { read: typeof h.io.read; write?: typeof h.io.write } = { read: h.io.read };
  const t = createCrossAccountTransport(scope, holder); holder.write = h.io.write;
  await expect(t.cancelAll()).rejects.toThrow("scoped writes unavailable");
  expect(h.requests).toHaveLength(0);
});
for (const invalid of [{ ...scope, subaccount: -1 }, { ...scope, subaccount: NaN }, { ...scope, subaccount_type: "isolated" },
  { subaccount: 7 }, { ...scope, origin: "https://fixture.invalid/path" }]) {
  it("does not infer missing/invalid scope", () => {
    const h = harness();
    expect(() => createCrossAccountTransport(invalid as CrossScope, h.io)).toThrow();
    expect(h.requests).toHaveLength(0);
  });
}
it("system or conflicting scoped order history cannot become known exposure ownership", async () => {
  const h = harness(), { t, oms: manager } = oms(h);
  await manager.submit(intent);
  h.orders[0]!.raw.order_source = "system";
  await expect(t.listOrders({})).rejects.toThrow("ambiguous scoped");
  h.orders[0]!.raw.order_source = "user"; h.orders[0]!.raw.subaccount = 8;
  await expect(t.listOrders({})).rejects.toThrow("ambiguous scoped");
});
it("scoped OMS ignores caller-supplied other-account positions", async () => {
  const h = harness(), { oms: manager } = oms(h);
  const result = await manager.submit(intent, [{ market_ticker: "SAME", position: "-99.00", entry_price: "100.000000", unrealized_pnl: "0.000000", fees: "0.000000" }]);
  expect(result.status).toBe("ACK");
});
it("scope/IO mutation cannot change actual serialized origin/account", async () => {
  const h = harness(), mutable = { ...scope };
  const t = createCrossAccountTransport(mutable, h.io);
  mutable.origin = "https://other.invalid"; mutable.subaccount = 8;
  expect(t.scope).toEqual(scope);
  expect(Object.isFrozen(t.scope)).toBe(true);
});
it("partial trigger filled_count is not silently treated as fresh full coverage", async () => {
  const h = harness(), { oms: manager } = oms(h);
  const entry = await manager.submit(intent);
  h.positions = [position(7, 1), position(8, 99)];
  h.triggers = [bracket({ count: "2.00", filled_count: "1.00", stop_loss_price: "99.0000", take_profit_price: "102.0000" })];
  expect((await manager.ensureAfterFill(intent, entry.order_id!)).state).toBe("PROTECTION_FAILED");
});
it("invalid trigger prices and body route overrides fail before mutation IO", async () => {
  const h = harness(), { t } = oms(h);
  await expect(t.setCrossExitTrigger("SAME", { subaccount: 8, stop_loss_price: "99.0000" })).rejects.toThrow("scoped query");
  expect(h.requests).toHaveLength(0);
  h.triggers = [bracket({ stop_loss_price: "99.000000000001" })];
  await expect(t.getCrossExitTriggers("SAME")).rejects.toThrow("price");
});
it("uncertain scoped dispatch blocks new exposure and cannot invent an ACK account", async () => {
  const h = harness(); const write = h.io.write;
  h.io.write = async (req) => { await write(req); throw new Error("reply lost"); };
  const { oms: manager } = oms(h);
  expect((await manager.submit(intent)).status).toBe("UNKNOWN: will reconcile, not resend");
  const count = h.requests.length;
  expect((await manager.submit({ ...intent, decisionId: "second" })).status).toContain("BLOCKED");
  expect(h.requests).toHaveLength(count);
});
it("unsupported scoped reduce-only maker TIF is rejected, never silently rewritten", () => {
  const h = harness(), { t } = oms(h);
  expect(() => t.prepareCreate({ ...toCreateReq({ ...intent, kind: "exit" }),
    client_order_id: scopedClientOrderId(scope, intent), subaccount: 7 })).toThrow("not rewritten");
  expect(h.requests).toHaveLength(0);
});
it("scoped bracket comparisons use exact fixed-point units, not Number aliases", async () => {
  const { scopedBracketCovers } = await import("./cross-account");
  const trigger = { id: "trg1", kind: "bracket", status: "active", count: "90071992547409.90", filled_count: "0.00", stop: "99.0000", take: "102.0000", trail: null };
  expect(scopedBracketCovers(trigger, "99.0000", "102.0000", "90071992547409.91")).toBe(false);
  expect(scopedBracketCovers({ ...trigger, count: "0.00", stop: "9007199254.740901" }, "9007199254.7409", "102.0000", "1.00")).toBe(false);
});
it("capped scoped exit keeps journal/request CID consistent and flat exits do not send", async () => {
  const h = harness(); h.positions = [position(7, 1), position(8, 99)];
  const { oms: manager, t } = oms(h);
  const result = await manager.submit({ ...intent, kind: "exit", maker: false, qty: 2, plan: undefined });
  const post = h.requests.find((r) => r.method === "POST")!;
  expect(JSON.parse(post.body!).count).toBe("1");
  expect(result.cid).toBe(JSON.parse(post.body!).client_order_id);
  expect(manager.rows.find((r) => r.state === "INTENT")!.cid).toBe(result.cid);
  const count = h.requests.filter((r) => r.method === "POST").length;
  expect((await manager.submit({ ...intent, kind: "exit", maker: false, decisionId: "flat", plan: undefined })).status).toContain("NO_POSITION");
  expect(h.requests.filter((r) => r.method === "POST")).toHaveLength(count);
  expect(t.scope.subaccount).toBe(7);
});
it("unrepresentable selected quantity is unknown, never rounded into another quantity", async () => {
  const h = harness(), { t } = oms(h);
  h.positions = [{ ...position(7, 1), position: "90071992547409.91" }];
  await expect(t.positions()).rejects.toThrow();
});

it("scoped OMS without a durable journal path cannot dispatch", async () => {
  const h = harness(), manager = oms(h, null).oms;
  expect((await manager.submit(intent)).status).toContain("LOCKED");
  expect(h.requests).toEqual([]);
  expect((await manager.killAndFlatten("x", "x", {}, "kill")).ok).toBe(false);
  expect(h.requests).toEqual([]);
});
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
it("QC concurrent identical submissions reserve one CID", async () => {
 const h = harness(), g = deferred<void>(), read = h.io.read; h.io.read = async r => { await g.promise; return read(r); };
 const m = oms(h).oms, a = m.submit(intent), b = m.submit(intent); g.resolve(); await Promise.all([a,b]);
 expect(h.requests.filter(r => r.method === "POST")).toHaveLength(1); expect(m.rows.filter(r => r.state === "INTENT")).toHaveLength(1);
});
it("QC deferred entry rechecks KILL, new failure and permission", async () => {
 for (const change of ["kill", "failure", "permission"]) {
  const h = harness(), g = deferred<void>(), started = deferred<void>(), read = h.io.read;
  h.io.read = async r => { started.resolve(); await g.promise; return read(r); };
  const m = oms(h).oms, pending = m.submit(intent); await started.promise;
  const kill = change === "kill" ? m.killAndFlatten("x","x",{},"kill") : Promise.resolve();
  if (change === "failure") m.blocked = "new failure";
  if (change === "permission") (m as unknown as { allowSend: boolean }).allowSend = false;
  g.resolve(); await kill; await pending; expect(h.requests.filter(r => r.method !== "GET")).toEqual([]);
 }
});
it("QC detach intent and plan before positions and POST await", async () => {
 const h = harness(), g = deferred<void>(), started = deferred<void>(), pg = deferred<void>(), ps = deferred<void>(), read = h.io.read, write = h.io.write;
 h.io.read = async r => { if (r.url.endsWith("/positions")) { started.resolve(); await g.promise; } return read(r); };
 h.io.write = async r => { if (r.method === "POST") { ps.resolve(); await pg.promise; } return write(r); };
 const m = oms(h).oms, input = structuredClone(intent), p = m.submit(input); await started.promise;
 input.qty = 3; input.ticker = "MUTATED"; input.decisionId = "changed"; input.price = 105; input.plan!.stop = 50;
 g.resolve(); await ps.promise; input.plan!.t2 = 999; pg.resolve(); const result = await p;
 const row = m.rows.find(r => r.state === "INTENT")!; expect(row.intent).toEqual(intent); expect(Object.isFrozen(row.intent!.plan)).toBe(true);
 expect(result.cid).toBe(JSON.parse(row.serializedRequest!.body).client_order_id);
 expect(JSON.parse(h.requests.find(r => r.method === "PUT")!.body!).stop_loss_price).toBe("99.0000");
});
it("QC unknown first dispatch prevents queued second attempt", async () => {
 const h = harness(), g = deferred<void>(); let posts = 0;
 h.io.write = async r => { if (r.method === "POST") { posts++; await g.promise; throw Error("uncertain"); } return {status:204,body:null}; };
 const m = oms(h).oms, a = m.submit(intent), b = m.submit({...intent,decisionId:"second"}); g.resolve(); await Promise.all([a,b]); expect(posts).toBe(1);
});
it("QC orphan protection cannot mutate", async () => {
 for (const file of [null, join(mkdtempSync(join(tmpdir(),"orphan-")),"j")]) { const h = harness(); h.positions = [position(7,1)]; await oms(h,file).oms.ensureAfterFill(intent,"arbitrary"); expect(h.requests.filter(r=>r.method === "PUT")).toHaveLength(0); }
});
it("QC same CID two order IDs reject cancel and restore", async () => {
 const h = harness(), {oms:m,t} = oms(h); await m.submit(intent); h.orders.push({account:7,raw:{...h.orders[0]!.raw,order_id:"other"}});
 await expect(t.cancelOrder("order-1")).rejects.toThrow(); const file = join(mkdtempSync(join(tmpdir(),"restore-")),"j");
 writeFileSync(file,m.rows.map(r=>JSON.stringify(r)).join("\n")+"\n"+JSON.stringify({...m.rows.find(r=>r.state === "ACK")!,order_id:"other"})+"\n");
 const restored = createCrossAccountTransport(scope,h.io); new PerpsOms(restored,file,false); h.orders.pop(); await expect(restored.cancelOrder("order-1")).rejects.toThrow();
});
it("QC contradictory ACK fields fail UNKNOWN", async () => {
 for (const extra of [{client_order_id:"wrong"},{subaccount:8},{subaccount_type:"isolated"},{ticker:"other"},{side:"ask"},{fill_count:"3.00"}]) {
  const h = harness(), write = h.io.write; h.io.write = async r => {const reply = await write(r); return r.method === "POST" ? {...reply,body:{...reply.body,...extra}} : reply;}; expect((await oms(h).oms.submit(intent)).status).toContain("UNKNOWN");
 }
});
it("QC corrupt JSON intent is inspectably blocked without history changes", () => {
 const h = harness(), file = join(mkdtempSync(join(tmpdir(),"corrupt-")),"j"), raw = JSON.stringify({cid:"bad",at:"x",state:"INTENT",intent:{ticker:"SAME"},intendedRouting:scope})+"\n"; writeFileSync(file,raw); let m:PerpsOms|undefined;
 expect(()=>{m=new PerpsOms(createCrossAccountTransport(scope,h.io),file,false);}).not.toThrow(); expect(m!.blocked).toBeTruthy(); expect(readFileSync(file,"utf8")).toBe(raw); expect(m!.rows).toHaveLength(1);
});
it("QC standalone create rejects syntactic invalidity", () => {
 const t=createCrossAccountTransport(scope,harness().io), base={...toCreateReq(intent),client_order_id:scopedClientOrderId(scope,intent),subaccount:7};
 for (const extra of [{count:"0"},{price:"-1"},{side:"oops"},{time_in_force:"oops"},{self_trade_prevention_type:"oops"},{client_order_id:"mm-perps-v2-nonsense"}]) expect(()=>t.prepareCreate({...base,...extra} as never)).toThrow();
});
it("QC multi-ticker repeated kill is closed and preserves protection", async () => {
 const h=harness(); h.positions=[position(7,1),{...position(7,2),market_ticker:"SECOND"}]; h.triggers=[bracket()]; const m=oms(h).oms;
 for(let n=0;n<2;n++) expect((await m.killAndFlatten("x","x",{},"kill")).ok).toBe(false);
 expect(h.requests.filter(r=>r.method!=="GET")).toEqual([]); expect(h.triggers).toHaveLength(1);
});

it("QC protection persists exact request before PUT and journal failure prevents mutation", async () => {
 for (const fail of [false,true]) {
  const h=harness(), file=join(mkdtempSync(join(tmpdir(),"protect-journal-")),"j"), m=oms(h,file).oms;
  const entry=await m.submit(intent); h.positions=[position(7,1)]; h.triggers=[];
  const puts=h.requests.filter(r=>r.method === "PUT").length;
  h.onWrite=r=>{ if(r.method === "PUT") { const rows=readFileSync(file,"utf8").trim().split("\n").map(x=>JSON.parse(x)); expect(rows.at(-1).protectionRequest).toEqual(r); } };
  if(fail) { renameSync(file,file+".saved"); mkdirSync(file); }
  try { await m.ensureAfterFill(intent,entry.order_id!); } catch { /* append failure must not reach PUT */ }
  expect(h.requests.filter(r=>r.method === "PUT")).toHaveLength(puts+(fail?0:1));
  if(fail) expect(m.blocked).toBeTruthy();
 }
});
it("QC corrupt JSON null row remains inspectable",()=>{
 const h=harness(),file=join(mkdtempSync(join(tmpdir(),"null-row-")),"j");writeFileSync(file,"null\n"); let m:PerpsOms|undefined;
 expect(()=>{m=new PerpsOms(createCrossAccountTransport(scope,h.io),file,false);}).not.toThrow();expect(m!.rows).toEqual([null]);expect(m!.blocked).toBeTruthy();
});

it("QC conflicting remembered association remains unusable even after history changes",async()=>{
 const h=harness(),{oms:m,t}=oms(h);await m.submit(intent);const cid=String(h.orders[0]!.raw.client_order_id);
 expect(()=>t.rememberIntendedOrder("other",cid)).toThrow();await expect(t.cancelOrder("order-1")).rejects.toThrow();
});
it("QC protective reduce-only exit remains available after KILL blocks entries",async()=>{
 const h=harness(),m=oms(h).oms;await m.submit(intent);h.positions=[position(7,1)];
 await m.killAndFlatten("x","x",{},"kill");
 expect((await m.submit({...intent,kind:"exit",maker:false,qty:1,plan:undefined})).status).toBe("ACK");
 expect(m.blocked).toContain("KILL");
});
it("QC truncated durable journal cannot be replaced by in-memory protection association",async()=>{
 const h=harness(),file=join(mkdtempSync(join(tmpdir(),"truncate-")),"j"),m=oms(h,file).oms;
 const entry=await m.submit(intent);h.positions=[position(7,1)];h.triggers=[];const puts=h.requests.filter(r=>r.method==="PUT").length;
 writeFileSync(file,"");await m.ensureAfterFill(intent,entry.order_id!);
 expect(h.requests.filter(r=>r.method==="PUT")).toHaveLength(puts);expect(readFileSync(file,"utf8")).toBe("");
});

it("QC concurrent uncertain capped exits do not resend actual serialized CID",async()=>{
 const h=harness();h.positions=[position(7,1)];let posts=0;h.io.write=async()=>{posts++;throw Error("uncertain exit");};
 const m=oms(h).oms;
 await Promise.all([m.submit({...intent,kind:"exit",maker:false,qty:2,plan:undefined}),m.submit({...intent,kind:"exit",maker:false,qty:3,plan:undefined})]);
 expect(posts).toBe(1);expect(m.rows.filter(r=>r.state==="INTENT")).toHaveLength(1);
});
it("QC protection persistence exception cannot reach mutation IO",async()=>{
 const h=harness(),file=join(mkdtempSync(join(tmpdir(),"append-fail-")),"j"),m=oms(h,file).oms;
 const entry=await m.submit(intent);h.positions=[position(7,1)];h.triggers=[];const puts=h.requests.filter(r=>r.method==="PUT").length;
 // Fault-inject the persistence method after durable association preflight; no production hook is added.
 const holder=m as unknown as {log:(row:Record<string,unknown>)=>void}, persist=holder.log.bind(m);
 holder.log=row=>{if(row.protectionRequest)throw Error("injected persistence failure");persist(row);};
 try{await m.ensureAfterFill(intent,entry.order_id!);}catch{/* no mutation on persistence exception */}
 expect(h.requests.filter(r=>r.method==="PUT")).toHaveLength(puts);expect(m.blocked).toBeTruthy();
});
for(const cause of ["duplicate-history","duplicate-list-history","same-order-history","rejected-remember","same-order-other-cid"]) it(`QC2 poisoned repair remains refused after unique history and reuse: ${cause}`,async()=>{
  const h=harness(),file=join(mkdtempSync(join(tmpdir(),"poison-repair-")),"j"),{oms:m,t}=oms(h,file);
  const entry=await m.submit(intent),cid=entry.cid,id=entry.order_id!;
  if(cause==="duplicate-history" || cause==="duplicate-list-history" || cause==="same-order-history"){
   h.orders.push({account:7,raw:{...h.orders[0]!.raw,order_id:cause==="same-order-history"?id:"other",client_order_id:cause==="same-order-history"?"conflicting-cid":cid}});
   await expect(cause==="duplicate-list-history"?t.listOrders({}):t.cancelOrder(id)).rejects.toThrow();h.orders.pop();
  }else expect(()=>t.rememberIntendedOrder(cause==="rejected-remember"?"other":id,cause==="rejected-remember"?cid:scopedClientOrderId(scope,{...intent,decisionId:"other"}))).toThrow();
  h.positions=[position(7,1)];h.triggers=[];const puts=h.requests.filter(r=>r.method==="PUT").length;
  expect((await m.ensureAfterFill(intent,id)).state).toBe("PROTECTION_FAILED");
  expect(h.requests.filter(r=>r.method==="PUT")).toHaveLength(puts);
  const restored=new PerpsOms(t,file,true);await restored.ensureAfterFill(intent,id);
  expect(h.requests.filter(r=>r.method==="PUT")).toHaveLength(puts);
});
it("QC2 known poison blocks repair prepare and poison after preparation blocks dispatch",async()=>{
 const h=harness(),{oms:m,t}=oms(h),entry=await m.submit(intent),a={orderId:entry.order_id!,cid:entry.cid};
 const body={kind:"bracket",count:"1",stop_loss_price:"99",take_profit_price:"102"};
 const prepare=t.prepareProtection as unknown as (ticker:string,body:Record<string,unknown>,association:typeof a)=>import("./cross-account").Request;
 const prepared=prepare("SAME",body,a),before=h.requests.filter(r=>r.method==="PUT").length;
 expect(()=>t.rememberIntendedOrder("other",a.cid)).toThrow();
 expect(()=>prepare("SAME",body,a)).toThrow();await expect(t.dispatchProtection(prepared)).rejects.toThrow();
 expect(h.requests.filter(r=>r.method==="PUT")).toHaveLength(before);
});
it("QC2 explicit flatten remains gated, capped, and usable without entry history and after local KILL",async()=>{
 for(const killed of [false,true]){
  const h=harness();h.positions=[position(7,1),position(8,99)];const m=oms(h).oms;
  if(killed)await m.killAndFlatten("x","x",{},"kill");
  const result=await m.submit({...intent,kind:"flatten",maker:false,qty:3,plan:undefined});expect(result.status).toBe("ACK");
  const request=h.requests.find(r=>r.method==="POST")!,body=JSON.parse(request.body!);
  expect(body.count).toBe("1");expect(body.reduce_only).toBe(true);expect(body.subaccount).toBe(7);
  expect(m.rows.filter(r=>r.state==="INTENT")).toHaveLength(1);expect(h.positions[1]!.position).toBe("99.00");
 }
});
it("QC2 uncertain concurrent explicit flatten never resends capped CID",async()=>{
 const h=harness();h.positions=[position(7,1)];let posts=0;h.io.write=async()=>{posts++;throw Error("uncertain");};const m=oms(h).oms;
 await Promise.all([m.submit({...intent,kind:"flatten",maker:false,qty:2,plan:undefined}),m.submit({...intent,kind:"flatten",maker:false,qty:3,plan:undefined})]);
 expect(posts).toBe(1);expect(m.rows.filter(r=>r.state==="INTENT")).toHaveLength(1);
});

it("QC2 poisoning between persisted repair intent and actual dispatch prevents PUT",async()=>{
 const h=harness(),file=join(mkdtempSync(join(tmpdir(),"dispatch-poison-")),"j"),{oms:m,t}=oms(h,file);
 const entry=await m.submit(intent);h.positions=[position(7,1)];h.triggers=[];const puts=h.requests.filter(r=>r.method==="PUT").length;
 const holder=m as unknown as {log:(row:Record<string,unknown>)=>void},persist=holder.log.bind(m);
 holder.log=row=>{persist(row);if(row.protectionRequest){try{t.rememberIntendedOrder("conflict",entry.cid);}catch{/* observed poison retained */}}};
 expect((await m.ensureAfterFill(intent,entry.order_id!)).state).toBe("PROTECTION_FAILED");expect(h.requests.filter(r=>r.method==="PUT")).toHaveLength(puts);
});
const qc3InvalidHistory: Record<string,unknown>[] = [
 {subaccount:8},{subaccount_type:"isolated"},{subaccount:null},{subaccount_type:42},
 {order_id:""},{client_order_id:""},{order_source:"system"},{order_source:null},
 {side:"invalid"},{ticker:""},{ticker:42},{user_id:null},
 {price:"bad"},{fill_count:"bad"},{remaining_count:"bad"},
];
for(const consumer of ["list","cancel"] as const) for(const invalid of qc3InvalidHistory)
it(`QC3 shared rejected history poisons repair ${consumer} ${JSON.stringify(invalid)}`,async()=>{
 const h=harness(),file=join(mkdtempSync(join(tmpdir(),"semantic-poison-")),"j"),{oms:m,t}=oms(h,file);
 const entry=await m.submit(intent),id=entry.order_id!,cid=entry.cid,original={...h.orders[0]!.raw};
 const body={kind:"bracket",count:"1",stop_loss_price:"99",take_profit_price:"102"},association={orderId:id,cid};
 const prepared=t.prepareProtection("SAME",body,association),puts=h.requests.filter(r=>r.method==="PUT").length;
 h.orders[0]!.raw={...original,...invalid};
 await expect(consumer==="list"?t.listOrders({}):t.cancelOrder(id)).rejects.toThrow();
 expect(t.intendedAssociation(id,cid)).toBe(false);
 expect(()=>t.prepareProtection("SAME",body,association)).toThrow();await expect(t.dispatchProtection(prepared)).rejects.toThrow();
 h.orders[0]!.raw=original;await t.listOrders({});h.positions=[position(7,1)];h.triggers=[];
 expect((await m.ensureAfterFill(intent,id)).state).toBe("PROTECTION_FAILED");
 const reused=new PerpsOms(t,file,true);expect((await reused.ensureAfterFill(intent,id)).state).toBe("PROTECTION_FAILED");
 expect(t.intendedAssociation(id,cid)).toBe(false);expect(h.requests.filter(r=>r.method==="PUT")).toHaveLength(puts);
});
for(const consumer of ["list","cancel"] as const) it(`QC3 omitted metadata remains unverified but valid for repair ${consumer}`,async()=>{
 const h=harness(),write=h.io.write;
 h.io.write=async r=>{const reply=await write(r);if(r.method==="PUT" && h.positions.some(p=>p.subaccount===7 && p.position==="1.00"))h.triggers=h.triggers.map(t=>({...t,status:"active"}));return reply;};
 const {oms:m,t}=oms(h),entry=await m.submit(intent);
 delete h.orders[0]!.raw.subaccount;delete h.orders[0]!.raw.subaccount_type;
 if(consumer==="list")await t.listOrders({});else await t.cancelOrder(entry.order_id!);
 expect(t.intendedAssociation(entry.order_id!,entry.cid)).toBe(true);h.positions=[position(7,1)];h.triggers=[];
 const puts=h.requests.filter(r=>r.method==="PUT").length;expect((await m.ensureAfterFill(intent,entry.order_id!)).state).toBe("PROTECTION_VERIFIED");
 expect(h.requests.filter(r=>r.method==="PUT")).toHaveLength(puts+1);
});
