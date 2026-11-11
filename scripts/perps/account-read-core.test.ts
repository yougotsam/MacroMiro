import { expect, it } from "bun:test";
import { runAccountRead } from "./account-read-core";
const args = ["--subaccount", "7", "--subaccount-type", "cross"];
const account = { subaccount: 7, subaccount_type: "cross" };
const order = { ...account, order_id: "o1", client_order_id: "c1", ticker: "SAME", status: "resting", order_source: "user" };
const line = { at: new Date(0).toISOString(), cid: "c1", state: "ACK", order_id: "o1" };
function dependencies(options: { positions?: unknown[]; orders?: unknown[]; fills?: unknown[]; journal?: string } = {}) {
  const calls: string[] = [];
  return { calls,
    loadReads: async () => {
      calls.push("load");
      return { sourceOrigin: "https://fixture.invalid", positions: async () => options.positions ?? [{ ...account, market_ticker: "SAME", position: "0.50" }],
        orders: async () => options.orders ?? [order], fills: async () => options.fills ?? [] };
    },
    readJournal: async (_path: string) => { calls.push("journal"); return options.journal ?? JSON.stringify(line); },
  };
}
for (const invalid of [[], ["--subaccount", "7"], ["--subaccount-type", "cross"],
  ["--subaccount", "-1", "--subaccount-type", "cross"],
  ["--subaccount", "1.5", "--subaccount-type", "cross"],
  ["--subaccount", "Infinity", "--subaccount-type", "cross"],
  ["--subaccount", "9007199254740992", "--subaccount-type", "cross"],
  ["--subaccount", "7", "--subaccount-type", "guess"],
  [...args, "--journal"], [...args, "--subaccount", "8"], [...args, "--unknown", "x"]]) {
  it(`rejects invalid arguments before imports or IO: ${JSON.stringify(invalid)}`, async () => {
    const d = dependencies();
    await expect(runAccountRead(invalid, d)).rejects.toThrow();
    expect(d.calls).toEqual([]);
  });
}
it("retains selected, other-account and unknown inventory with identical tickers", async () => {
  const result = await runAccountRead(args, dependencies({ positions: [
    { ...account, market_ticker: "SAME", position: "1.00" },
    { ...account, subaccount: 8, market_ticker: "SAME", position: "2.00" },
    { market_ticker: "SAME", position: "3.00" },
  ] }));
  expect(Object.values(result.inventory).map((rows) => rows.length)).toEqual([1, 1, 1]);
  expect(result.routingVerified).toBe(false);
  expect(result.lifecycleReady).toBe(false);
  expect(result.snapshot.sourceOrigin).toBe("https://fixture.invalid");
  expect("balance" in result).toBe(false);
});
it("correlates exact legacy references but never attributes ownership", async () => {
  const result = await runAccountRead([...args, "--journal", "fixture"], dependencies());
  expect(result.orders[0]!.correlation).toBe("exact-order-id-and-cid");
  expect(result.orders[0]!.ownership).toBe("unowned");
  expect(result.journal![0]!.ownership).toBe("unowned");
});
for (const orders of [[order, order], [order, { ...order, order_id: "o2" }],
  [{ ...order, subaccount: 8 }], [{ order_id: "o1", client_order_id: "c1" }]]) {
  it("keeps duplicate, outside-selection and missing account records unresolved", async () => {
    const result = await runAccountRead([...args, "--journal", "fixture"], dependencies({ orders }));
    expect(result.orders.every((o) => o.correlation === "unresolved")).toBe(true);
    expect(result.orders).toHaveLength(orders.length);
  });
}
for (const conflict of [ { ...line, cid: "other" }, { ...line, order_id: "other" },
  { ...line, scope: { ...account, sourceOrigin: "https://other.invalid" } },
  { ...line, scope: { ...account, subaccount: 8, sourceOrigin: "https://fixture.invalid" } }]) {
  it("rejects conflicting CID/order/account evidence", async () => {
    const result = await runAccountRead([...args, "--journal", "fixture"], dependencies({ journal: [line, conflict].map((x) => JSON.stringify(x)).join("\n") }));
    expect(result.orders[0]!.correlation).toBe("unresolved");
  });
}
it("preserves malformed, blank, unknown and unmatched journal lines and raw fills", async () => {
  const journal = `${JSON.stringify(line)}\nnot json\n\n42\n${JSON.stringify({ ...line, cid: "outside", order_id: "outside" })}`;
  const fill = { fill_id: "unknown", order_id: "external", extra: "1.000000" };
  const result = await runAccountRead([...args, "--journal", "fixture"], dependencies({ journal, fills: [fill] }));
  expect(result.journal).toHaveLength(5);
  expect(result.journal![1]!.raw).toBe("not json");
  expect(result.journal![4]!.correlated).toBe(false);
  expect(result.journalIntegrity).toBe("invalid lines preserved");
  expect(result.snapshot.fills[0]!.raw).toEqual(fill);
});
it("propagates history failure rather than returning a report", async () => {
  const d = dependencies();
  const load = d.loadReads;
  d.loadReads = async () => ({ ...await load(), orders: async () => { throw new Error("incomplete history"); } });
  await expect(runAccountRead(args, d)).rejects.toThrow("incomplete history");
});
it("permits an explicitly selected zero or managed slot beyond 63, without defaulting", async () => {
  for (const number of ["0", "1000"]) {
    const result = await runAccountRead(["--subaccount", number, "--subaccount-type", "managed_isolated"], dependencies());
    expect(result.snapshot.selection.subaccount).toBe(Number(number));
  }
});

it("does not load readers when the requested journal cannot be read", async () => {
  const d = dependencies();
  d.readJournal = async () => { throw new Error("unreadable journal"); };
  await expect(runAccountRead([...args, "--journal", "missing"], d)).rejects.toThrow("unreadable journal");
  expect(d.calls).toEqual([]);
});
it("does not certify correlations from a corrupt journal", async () => {
  const result = await runAccountRead([...args, "--journal", "fixture"], dependencies({
    journal: JSON.stringify(line) + "\n{broken",
  }));
  expect(result.orders[0]!.correlation).toBe("unresolved");
});
it("rejects conflicting reported journal account type", async () => {
  const result = await runAccountRead([...args, "--journal", "fixture"], dependencies({
    journal: JSON.stringify({ ...line, subaccount_type: "isolated" }),
  }));
  expect(result.orders[0]!.correlation).toBe("unresolved");
});

import { readAccountRequestEvidence } from "../../src/lib/perps/request-evidence";
const officialOrder = { order_id: "o1", user_id: "fixture-user", client_order_id: "c1", ticker: "SAME", side: "bid", price: "1.000000", fill_count: "0.50", remaining_count: "0.50", last_update_reason: "Trade", created_time: null, order_source: "user" };
async function requestFixture(orders: unknown[] = [officialOrder]) {
  return readAccountRequestEvidence("https://fixture.invalid", account as import("../../src/lib/perps/scoped-snapshot").MarginAccount,
    ["SAME"], async (_path, field) => field === "orders" ? orders : [], async () => []);
}
function scopedDependencies(orders: unknown[] = [officialOrder]) {
  return { ...dependencies({ orders, positions: [{ ...account, market_ticker: "SAME", position: "0.50" },
    { ...account, subaccount: 8, market_ticker: "SAME", position: "2.00" }] }),
    loadRequestEvidence: async () => requestFixture(orders) };
}
it("consumes actual request-filter evidence for official orders without inventing account fields", async () => {
  const result = await runAccountRead([...args, "--journal", "fixture"], scopedDependencies());
  expect(result.requestScopedOrders[0]!.correlation).toBe("exact-order-id-and-cid");
  expect(result.requestScopedOrders[0]!.ownership).toBe("unowned");
  expect(result.orders[0]!.record.attribution).toBe("unowned");
  expect(result.requestEvidence!.orders.rows[0]).toEqual(officialOrder);
  expect(Object.hasOwn(result.requestEvidence!.orders.rows[0] as object, "subaccount")).toBe(false);
  expect(result.inventory.other).toHaveLength(1);
  expect(result.lifecycleReady).toBe(false);
});
for (const source of ["system", undefined]) {
  it(`keeps ${source ?? "unknown"} request-filtered orders unresolved`, async () => {
    const result = await runAccountRead([...args, "--journal", "fixture"], scopedDependencies([{ ...officialOrder, ...(source ? { order_source: source } : {}) }].map((o) => {
      if (!source) { const { order_source: _source, ...rest } = o; return rest; } return o;
    })));
    expect(result.requestScopedOrders[0]!.correlation).toBe("unresolved");
  });
}
it("rejects conflicting row account facts despite a valid request filter", async () => {
  const result = await runAccountRead([...args, "--journal", "fixture"], scopedDependencies([{ ...officialOrder, subaccount: 8 }]));
  expect(result.requestScopedOrders[0]!.correlation).toBe("unresolved");
});
it("keeps duplicate request mappings unresolved and preserves both records", async () => {
  const result = await runAccountRead([...args, "--journal", "fixture"], scopedDependencies([officialOrder, officialOrder]));
  expect(result.requestScopedOrders).toHaveLength(2);
  expect(result.requestScopedOrders.every((r) => r.correlation === "unresolved")).toBe(true);
});
it("checks actual GET paths including trigger account and encoded ticker", async () => {
  const paths: string[] = [];
  const result = await readAccountRequestEvidence("https://fixture.invalid", { subaccount: 7, subaccount_type: "cross" },
    ["SAME/slash", "SAME/slash"], async (path) => { paths.push(path); return []; },
    async (path) => { paths.push(path); return []; });
  expect(paths).toEqual([
    "/trade-api/v2/margin/orders?limit=1000&subaccount=7",
    "/trade-api/v2/margin/fills?limit=1000&subaccount=7",
    "/trade-api/v2/margin/cross/positions/SAME%2Fslash/exit_trigger?subaccount=7",
  ]);
  expect(result.crossTriggers).toHaveLength(1);
  expect(result.orders.request.method).toBe("GET");
  expect(Object.isFrozen(result)).toBe(true);
});
it("does not route other inventory modes through cross trigger endpoints", async () => {
  let calls = 0;
  const result = await readAccountRequestEvidence("https://fixture.invalid", { subaccount: 1000, subaccount_type: "managed_isolated" },
    ["SAME"], async () => [], async () => { calls++; return []; });
  expect(calls).toBe(0);
  expect(result.crossTriggers).toHaveLength(0);
});
it("propagates a scoped history failure", async () => {
  const d = scopedDependencies();
  d.loadRequestEvidence = async () => { throw new Error("incomplete scoped history"); };
  await expect(runAccountRead(args, d)).rejects.toThrow("incomplete scoped history");
});
it("rejects mismatched evidence query before showing correlations", async () => {
  const d = scopedDependencies();
  d.loadRequestEvidence = async () => {
    const e = await requestFixture();
    return { ...e, orders: { ...e.orders, request: { ...e.orders.request, path: "/trade-api/v2/margin/orders?subaccount=8" } } };
  };
  await expect(runAccountRead(args, d)).rejects.toThrow("request evidence mismatch");
});

it("copies early scoped history before slower reads finish", async () => {
  let doneOrders!: (rows: unknown[]) => void;
  let doneFills!: (rows: unknown[]) => void;
  const early = new Promise<unknown[]>((resolve) => { doneOrders = resolve; });
  const late = new Promise<unknown[]>((resolve) => { doneFills = resolve; });
  const raw = { ...officialOrder, extra: { value: "1.000000" } };
  const pending = readAccountRequestEvidence("https://fixture.invalid", { subaccount: 7, subaccount_type: "cross" }, [],
    (_path, field) => field === "orders" ? early : late, async () => []);
  doneOrders([raw]);
  await early.then(() => { raw.extra.value = "9.000000"; });
  doneFills([]);
  const result = await pending;
  expect(result.orders.rows[0]).toEqual({ ...officialOrder, extra: { value: "1.000000" } });
});

for (const change of ["cross-swapped cid", "ticker", "user_id", "side", "missing ticker", "invalid ticker"] as const) {
  it(`rejects conflicting immutable original-vs-filtered identity: ${change}`, async () => {
    const original = [officialOrder, { ...officialOrder, order_id: "o2", client_order_id: "c2" }];
    const filtered: Record<string, unknown> = { ...officialOrder };
    if (change === "cross-swapped cid") filtered.client_order_id = "c2";
    if (change === "ticker") filtered.ticker = "OTHER";
    if (change === "user_id") filtered.user_id = "other-user";
    if (change === "side") filtered.side = "ask";
    if (change === "missing ticker") delete filtered.ticker;
    if (change === "invalid ticker") filtered.ticker = 123;
    const d = { ...dependencies({ orders: original, journal: JSON.stringify({ ...line, cid: filtered.client_order_id }) }),
      loadRequestEvidence: async () => requestFixture([filtered]) };
    const result = await runAccountRead([...args, "--journal", "fixture"], d);
    expect(result.requestScopedOrders[0]!.correlation).toBe("unresolved");
  });
}
it("permits mutable fill/remaining/timestamp differences across non-atomic reads", async () => {
  const d = { ...dependencies({ orders: [officialOrder] }), loadRequestEvidence: async () => requestFixture([
    { ...officialOrder, fill_count: "1.00", remaining_count: "0.00", last_update_time: new Date(0).toISOString() },
  ]) };
  const result = await runAccountRead([...args, "--journal", "fixture"], d);
  expect(result.requestScopedOrders[0]!.correlation).toBe("exact-order-id-and-cid");
});

for (const patch of [{ user_id: 42 }, { side: "other" }, { client_order_id: 42 }, { ticker: "" }]) {
  it(`keeps malformed order identity unresolved: ${JSON.stringify(patch)}`, async () => {
    const d = { ...dependencies({ orders: [officialOrder] }),
      loadRequestEvidence: async () => requestFixture([{ ...officialOrder, ...patch }]) };
    const result = await runAccountRead([...args, "--journal", "fixture"], d);
    expect(result.requestScopedOrders[0]!.correlation).toBe("unresolved");
  });
}

for (const field of ["orders", "fills", "crossTriggers"] as const) {
  for (const defect of ["origin", "method", "path", "selector", "duplicate selector"] as const) {
    it(`rejects ${field} request evidence with ${defect} mismatch`, async () => {
      const d = scopedDependencies();
      d.loadRequestEvidence = async () => {
        const evidence = await requestFixture();
        const target = field === "crossTriggers" ? evidence.crossTriggers[0]! : evidence[field];
        const request = { ...target.request } as Record<string, unknown>;
        let sourceOrigin = target.sourceOrigin;
        if (defect === "origin") sourceOrigin = "https://other.invalid";
        if (defect === "method") request.method = "POST";
        if (defect === "path") request.path = String(request.path).replace("/margin/", "/wrong/");
        if (defect === "selector") request.subaccount = 8;
        if (defect === "duplicate selector") request.path = String(request.path) + "&subaccount=7";
        const changed = { ...target, sourceOrigin, request };
        return { ...evidence, [field]: field === "crossTriggers" ? [changed] : changed } as unknown as typeof evidence;
      };
      await expect(runAccountRead(args, d)).rejects.toThrow("request evidence mismatch");
    });
  }
}
for (const ticker of [".", ".."]) {
  it(`rejects dot-only ticker ${ticker} before any reader`, async () => {
    let calls = 0;
    const read = async () => { calls++; return []; };
    await expect(readAccountRequestEvidence("https://fixture.invalid", { subaccount: 7, subaccount_type: "cross" }, [ticker], read, read)).rejects.toThrow();
    expect(calls).toBe(0);
  });
}
for (const key of ["subaccount", "subaccount_type"] as const) {
  it(`rejects accessor scope ${key} without invoking it or a reader`, async () => {
    let getters = 0; let readers = 0;
    const selection = Object.defineProperty({ ...account }, key, {
      enumerable: true, get() { getters++; return account[key]; },
    });
    const read = async () => { readers++; return []; };
    await expect(readAccountRequestEvidence("https://fixture.invalid", selection as import("../../src/lib/perps/scoped-snapshot").MarginAccount, [], read, read)).rejects.toThrow();
    expect(getters).toBe(0);
    expect(readers).toBe(0);
  });
}
it("rejects duplicate cross-trigger request envelopes", async () => {
  const d = scopedDependencies();
  d.loadRequestEvidence = async () => {
    const evidence = await requestFixture();
    return { ...evidence, crossTriggers: [...evidence.crossTriggers, ...evidence.crossTriggers] };
  };
  await expect(runAccountRead(args, d)).rejects.toThrow("request evidence mismatch");
});

for (const ticker of [".", ".."]) {
  it(`rejects ignored-mode dot ticker ${ticker} before reads too`, async () => {
    let calls = 0;
    const read = async () => { calls++; return []; };
    await expect(readAccountRequestEvidence("https://fixture.invalid", { subaccount: 1000, subaccount_type: "managed_isolated" }, [ticker], read, read)).rejects.toThrow();
    expect(calls).toBe(0);
  });
}
