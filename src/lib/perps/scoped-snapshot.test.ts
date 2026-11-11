import { expect, it } from "bun:test";
import { readScopedSnapshot, type SnapshotReads, type MarginAccount } from "./scoped-snapshot";

// Fixture account numbers are examples, not a selection for a live account.
const selection = { subaccount: 7, subaccount_type: "cross" } as const;
const position = (subaccount: number) => ({ ...selection, subaccount, market_ticker: "SAME", position: "1.00" });
function reads(positions: unknown[]): SnapshotReads {
  return { sourceOrigin: "https://fixture.invalid", positions: async () => positions, orders: async () => [], fills: async () => [] };
}
it("requires explicit selection before reading", async () => {
  let called = false;
  const r = { ...reads([]), positions: async () => { called = true; return []; } };
  await expect(readScopedSnapshot(r, null)).rejects.toThrow("explicit margin account selection required");
  expect(called).toBe(false);
});
it("retains same-ticker exposure in different accounts", async () => {
  const s = await readScopedSnapshot(reads([position(7), position(8)]), selection);
  expect(s.positions.map((p) => p.selected)).toEqual([true, false]);
  expect(s.usableForLifecycle).toBe(false);
  expect(s.atomic).toBe(false);
  expect(s.credentialScope).toBe("unverified");
});
it("never assigns missing account identity to the selection", async () => {
  const s = await readScopedSnapshot(reads([{ market_ticker: "SAME", position: "1.00" }]), selection);
  expect(s.positions[0]?.attribution).toBe("unowned");
  expect(s.positions[0]?.selected).toBe(false);
});
it("rejects duplicate position identities", async () => {
  await expect(readScopedSnapshot(reads([position(7), position(7)]), selection)).rejects.toThrow("duplicate scoped position");
});
it("retains raw history metadata without inventing missing order attribution", async () => {
  const order = { order_id: "o1", last_update_reason: "fixture", created_time: "2026-11-08T20:00:00Z" };
  const r = { ...reads([]), orders: async () => [order] };
  const s = await readScopedSnapshot(r, selection);
  expect(s.orders[0]?.raw).toEqual(order);
  expect(s.orders[0]?.attribution).toBe("unowned");
});
it("propagates incomplete history instead of returning a snapshot", async () => {
  const r = { ...reads([]), fills: async () => { throw new Error("incomplete history"); } };
  await expect(readScopedSnapshot(r, selection)).rejects.toThrow("incomplete history");
});
it("requires both account number and reported type to match", async () => {
  const s = await readScopedSnapshot(reads([{ ...position(7), subaccount_type: "isolated" }]), selection);
  expect(s.positions[0]?.selected).toBe(false);
});
for (const subaccount of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
  it(`does not read with invalid selection ${subaccount}`, async () => {
    let calls = 0;
    const r = { ...reads([]), positions: async () => { calls++; return []; } };
    await expect(readScopedSnapshot(r, { ...selection, subaccount })).rejects.toThrow(/selection required/);
    expect(calls).toBe(0);
  });
}
it("retains the exact read origin without inferring credentials", async () => {
  const s = await readScopedSnapshot(reads([]), selection);
  expect(s.sourceOrigin).toBe("https://fixture.invalid");
  expect(s.credentialScope).toBe("unverified");
});

for (const sourceOrigin of ["", "not-an-origin", "https://fixture.invalid/path", "ftp://fixture.invalid", "https://fixture.invalid/"]) {
  it(`rejects invalid origin before reading: ${JSON.stringify(sourceOrigin)}`, async () => {
    let calls = 0;
    const read = async () => { calls++; return []; };
    const r = { sourceOrigin, positions: read, orders: read, fills: read };
    await expect(readScopedSnapshot(r, selection)).rejects.toThrow("explicit read origin required");
    expect(calls).toBe(0);
  });
}
it("rejects an array carrying account properties before reading", async () => {
  let calls = 0;
  const read = async () => { calls++; return []; };
  const arraySelection = Object.assign([], selection);
  const r = { sourceOrigin: "https://fixture.invalid", positions: read, orders: read, fills: read };
  await expect(readScopedSnapshot(r, arraySelection)).rejects.toThrow("explicit margin account selection required");
  expect(calls).toBe(0);
});
it("captures the origin before asynchronous reads", async () => {
  const r = { ...reads([]) };
  r.positions = async () => { r.sourceOrigin = "https://changed.invalid"; return []; };
  const s = await readScopedSnapshot(r, selection);
  expect(s.sourceOrigin).toBe("https://fixture.invalid");
});

// Stability is observed after the adapter's own promise reaction, not before it.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
it("copies each early read before waiting for another reader", async () => {
  const early = deferred<unknown[]>();
  const late = deferred<unknown[]>();
  const payload = [{ ...position(7), extra: { decimal: "1.000000", nested: [null, { n: 1 }] } }];
  const pending = readScopedSnapshot({ ...reads([]), positions: () => early.promise, fills: () => late.promise }, selection);
  early.resolve(payload);
  // Registered after readScopedSnapshot attached its copy reaction to early.promise.
  await early.promise.then(() => { payload[0]!.extra.nested[1] = { n: 9 }; });
  late.resolve([]);
  const result = await pending;
  expect(result.positions[0]!.raw.extra).toEqual({ decimal: "1.000000", nested: [null, { n: 1 }] });
});
it("detaches input and deeply freezes output, wrappers and identities", async () => {
  const payload = [{ ...position(7), extra: { nested: [{ n: 1 }], nullable: null } }];
  const result = await readScopedSnapshot(reads(payload), selection);
  payload[0]!.extra.nested[0]!.n = 9;
  expect(result.positions[0]!.raw.extra).toEqual({ nested: [{ n: 1 }], nullable: null });
  function frozen(value: unknown): void {
    if (!value || typeof value !== "object") return;
    expect(Object.isFrozen(value)).toBe(true);
    for (const child of Object.values(value)) frozen(child);
  }
  frozen(result);
  const raw = result.positions[0]!.raw as unknown as { extra: { nested: { n: number }[] } };
  expect(Reflect.set(raw.extra.nested[0]!, "n", 55)).toBe(false);
  expect(raw.extra.nested[0]!.n).toBe(1);
});
it("captures origin and primitive selection before invoking any reader", async () => {
  const chosen: { subaccount: number; subaccount_type: "cross" } = { ...selection };
  const r = { ...reads([position(7)]) };
  r.positions = async () => {
    chosen.subaccount = 8;
    r.sourceOrigin = "https://changed.invalid";
    return [position(7)];
  };
  const result = await readScopedSnapshot(r, chosen);
  expect(result.selection.subaccount).toBe(7);
  expect(result.positions[0]!.selected).toBe(true);
  expect(result.sourceOrigin).toBe("https://fixture.invalid");
});
for (const subaccount_type of ["unknown", "", "Cross", "cross "]) {
  it(`rejects unsupported selection type ${JSON.stringify(subaccount_type)} before reads`, async () => {
    let calls = 0;
    const read = async () => { calls++; return []; };
    await expect(readScopedSnapshot({ ...reads([]), positions: read, orders: read, fills: read },
      { ...selection, subaccount_type } as MarginAccount)).rejects.toThrow(/selection required/);
    expect(calls).toBe(0);
  });
}
for (const subaccount of [NaN, Infinity, -Infinity]) {
  it(`rejects nonfinite selection ${subaccount} before reads`, async () => {
    let calls = 0;
    const read = async () => { calls++; return []; };
    await expect(readScopedSnapshot({ ...reads([]), positions: read, orders: read, fills: read },
      { ...selection, subaccount })).rejects.toThrow(/selection required/);
    expect(calls).toBe(0);
  });
}
for (const subaccount_type of ["cross", "isolated", "auto_rebalance", "managed_isolated"] as const) {
  it(`accepts supported type ${subaccount_type} without a guessed 63 cap`, async () => {
    const chosen = { subaccount: 1000, subaccount_type };
    const result = await readScopedSnapshot(reads([{ ...chosen, market_ticker: "SAME" }]), chosen);
    expect(result.positions[0]!.selected).toBe(true);
  });
}
it("keeps unknown reported account types unowned", async () => {
  const result = await readScopedSnapshot(reads([{ ...position(7), subaccount_type: "future_type" }]), selection);
  expect(result.positions[0]!.attribution).toBe("unowned");
  expect(result.positions[0]!.raw.subaccount_type).toBe("future_type");
});
it("preserves an own __proto__ JSON key without changing prototypes", async () => {
  const extra: unknown = JSON.parse('{"__proto__":{"polluted":true},"decimal":"0.000001","nil":null}');
  const result = await readScopedSnapshot(reads([{ ...position(7), extra }]), selection);
  const copied = result.positions[0]!.raw.extra as Record<string, unknown>;
  expect(Object.hasOwn(copied, "__proto__")).toBe(true);
  expect(Object.getPrototypeOf(copied)).toBe(Object.prototype);
  expect(copied.polluted).toBeUndefined();
  expect(copied).toEqual(extra);
});
const badValues: [string, () => unknown][] = [
  ["NaN", () => NaN], ["Infinity", () => Infinity], ["undefined", () => undefined],
  ["bigint", () => 1n], ["function", () => () => 1], ["symbol", () => Symbol("x")],
  ["date", () => new Date(0)], ["custom prototype", () => Object.create({ x: 1 })],
  ["cycle", () => { const x: { self?: unknown } = {}; x.self = x; return x; }],
  ["sparse array", () => new Array(2)],
  ["extended array", () => Object.assign([1], { extra: true })],
  ["symbol key", () => ({ [Symbol("x")]: 1 })],
  ["hidden property", () => Object.defineProperty({}, "hidden", { value: 1 })],
];
for (const field of ["positions", "orders", "fills"] as const) {
  for (const [label, make] of badValues) {
    it(`rejects ${label} in ${field}`, async () => {
      const r = { ...reads([]), [field]: async () => [{ extra: make() }] };
      await expect(readScopedSnapshot(r, selection)).rejects.toThrow();
    });
  }
}
it("rejects accessors without invoking them", async () => {
  let calls = 0;
  const extra = Object.defineProperty({}, "value", { enumerable: true, get() { calls++; return 1; } });
  await expect(readScopedSnapshot(reads([{ extra }]), selection)).rejects.toThrow();
  expect(calls).toBe(0);
});
it("rejects non-list reader results", async () => {
  const r = { ...reads([]), orders: async () => ({}) as unknown as unknown[] };
  await expect(readScopedSnapshot(r, selection)).rejects.toThrow();
});
it("accepts repeated noncyclic references as independent JSON copies", async () => {
  const shared = { decimal: "1.00" };
  const result = await readScopedSnapshot(reads([{ ...position(7), extra: [shared, shared] }]), selection);
  expect(result.positions[0]!.raw.extra).toEqual([shared, shared]);
});
