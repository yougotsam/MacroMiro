/** Stable parsed-JSON evidence only; not wire bytes, freshness, ownership or order permission. */
type Json = null | boolean | number | string | readonly Json[] | { readonly [key: string]: Json };
type Row = Readonly<Record<string, Json>>;
export type SubaccountType = "cross" | "isolated" | "auto_rebalance" | "managed_isolated";
export type MarginAccount = Readonly<{ subaccount: number; subaccount_type: SubaccountType }>;
export type SnapshotReads = Readonly<{
  sourceOrigin: string;
  positions(): Promise<unknown[]>;
  orders(): Promise<unknown[]>;
  fills(): Promise<unknown[]>;
}>;
export type ScopedRow =
  | Readonly<{ raw: Row; attribution: "unowned"; selected: false }>
  | Readonly<{ raw: Row; attribution: "reported"; account: MarginAccount; selected: boolean }>;

/** Reject rather than silently omit or coerce anything JSON cannot represent. */
function copyJson(value: unknown, active = new Set<object>()): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") throw new Error("non-JSON snapshot value");
  const array = Array.isArray(value);
  const proto = Object.getPrototypeOf(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) {
    throw new Error("non-JSON snapshot prototype");
  }
  if (active.has(value)) throw new Error("cyclic snapshot value");
  active.add(value);
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string")) throw new Error("symbol snapshot key");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (array) {
      const length = (value as unknown[]).length;
      // Dense arrays have exactly their indices plus length; reject extra props too.
      if (keys.length !== length + 1) throw new Error("sparse or extended snapshot array");
      const result: Json[] = [];
      for (let i = 0; i < length; i++) {
        const d = descriptors[String(i)];
        if (!d || !("value" in d) || !d.enumerable) throw new Error("non-JSON snapshot array item");
        result.push(copyJson(d.value, active));
      }
      return Object.freeze(result);
    }
    const result: Record<string, Json> = {};
    for (const key of keys as string[]) {
      const d = descriptors[key]!;
      if (!("value" in d) || !d.enumerable) throw new Error("non-JSON snapshot property");
      // defineProperty preserves an own __proto__ key without invoking its setter.
      Object.defineProperty(result, key, {
        value: copyJson(d.value, active), enumerable: true, writable: false, configurable: false,
      });
    }
    return Object.freeze(result);
  } finally { active.delete(value); }
}

function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("malformed snapshot row");
  return value as Row;
}
function account(value: unknown): MarginAccount | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return null;
  const number = Object.getOwnPropertyDescriptor(value, "subaccount");
  const type = Object.getOwnPropertyDescriptor(value, "subaccount_type");
  if (!number || !("value" in number) || !type || !("value" in type)) return null;
  const subaccount: unknown = number.value;
  const subaccountType: unknown = type.value;
  if (typeof subaccount !== "number" || !Number.isSafeInteger(subaccount) || subaccount < 0 ||
      (subaccountType !== "cross" && subaccountType !== "isolated" &&
       subaccountType !== "auto_rebalance" && subaccountType !== "managed_isolated")) return null;
  return Object.freeze({ subaccount, subaccount_type: subaccountType });
}
function copyList(value: unknown): readonly Json[] {
  const copied = copyJson(value);
  if (!Array.isArray(copied)) throw new Error("malformed snapshot list");
  return copied;
}

export async function readScopedSnapshot(reads: SnapshotReads, selection: MarginAccount | null) {
  const sourceOrigin = reads.sourceOrigin;
  let validOrigin = false;
  try {
    const url = new URL(sourceOrigin);
    validOrigin = ["https:", "http:"].includes(url.protocol) && url.origin === sourceOrigin;
  } catch { /* Invalid origins fail before any reads. */ }
  if (!validOrigin) throw new Error("explicit read origin required");
  const configured = account(selection);
  if (!configured) throw new Error("explicit margin account selection required");
  const startedAt = new Date().toISOString();
  // Each fulfillment reaction copies immediately, independently of slower readers.
  const [positions, orders, fills] = await Promise.all([
    reads.positions().then(copyList), reads.orders().then(copyList), reads.fills().then(copyList),
  ]);
  function tag(input: readonly Json[]): readonly ScopedRow[] {
    return Object.freeze(input.map((x): ScopedRow => {
      const raw = object(x);
      const reported = account(raw);
      if (!reported) return Object.freeze({ raw, attribution: "unowned", selected: false });
      return Object.freeze({ raw, attribution: "reported", account: reported,
        selected: reported.subaccount === configured!.subaccount && reported.subaccount_type === configured!.subaccount_type });
    }));
  }
  const scopedPositions = tag(positions);
  const seen = new Set<string>();
  for (const position of scopedPositions) {
    if (position.attribution !== "reported") continue;
    if (typeof position.raw.market_ticker !== "string" || !position.raw.market_ticker.trim()) throw new Error("position missing ticker");
    const key = JSON.stringify([position.account.subaccount, position.account.subaccount_type, position.raw.market_ticker]);
    if (seen.has(key)) throw new Error("duplicate scoped position");
    seen.add(key);
  }
  return Object.freeze({
    sourceOrigin, selection: configured,
    credentialScope: "unverified" as const, usableForLifecycle: false as const, atomic: false as const,
    startedAt, finishedAt: new Date().toISOString(), positions: scopedPositions, orders: tag(orders), fills: tag(fills),
  });
}

/** Stable parsed-JSON copy for consumed read-evidence envelopes, not wire evidence. */
export { copyJson as copySnapshotJson };
