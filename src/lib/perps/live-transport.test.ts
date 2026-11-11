import { describe, expect, it } from "bun:test";
import { readMarginArray, readMarginHistory, mapMarginFill, mapMarginOrder, mapMarginPosition, mapExitTrigger, marginCancelPath, exitTriggerPath } from "./live-transport";

describe("margin transport maps", () => {
  it("cancel path is the margin order, not the event book", () => {
    expect(marginCancelPath("ord/1")).toBe("/trade-api/v2/margin/orders/ord%2F1");
  });
  it("maps an order, a fill, and a position", () => {
    expect(mapMarginOrder({ order_id: "a", client_order_id: "c", ticker: "KXBTCPERP", side: "bid", price: "8.1", fill_count: "0", remaining_count: "1" }).side).toBe("bid");
    expect(mapMarginFill({ fill_id: "f", order_id: "a", is_taker: false, side: "ask", count: "1", price: "8", fees: "0.01", realized_pnl: "0", ticker: "KXBTCPERP", created_time: "t" }).is_taker).toBe(false);
    expect(mapMarginPosition({ market_ticker: "KXBTCPERP", position: "1", entry_price: "8", unrealized_pnl: "0", fees: "0" }).position).toBe("1");
  });
  it("stop path is the cross exit trigger, and a listed trigger keeps its stop", () => {
    expect(exitTriggerPath("KXBTCPERP")).toBe("/trade-api/v2/margin/cross/positions/KXBTCPERP/exit_trigger");
    expect(exitTriggerPath("KXBTCPERP", "trg-1")).toBe("/trade-api/v2/margin/cross/positions/KXBTCPERP/exit_trigger/trg-1");
    expect(mapExitTrigger({ id: "trg-1", kind: "bracket", prices: { stop_loss_price: "8.00", take_profit_price: "8.40" } })).toMatchObject({ id: "trg-1", stop: "8.00", take: "8.40" });
  });
  it("refuses a row that has no side", () => {
    expect(() => mapMarginOrder({ order_id: "a" })).toThrow(/side/);
  });
});

describe("margin history completeness (in-memory reader only)", () => {
  for (const field of ["orders", "fills"] as const) {
    const key = field === "orders" ? "order_id" : "fill_id";
    const page = (cursor: unknown, items: unknown = []) => ({ status: 200, body: { [field]: items, cursor } });
    const reader = (pages: { status: number; body: unknown }[]) => {
      let n = 0;
      return async () => {
        if (n >= pages.length) throw new Error("unexpected request");
        return pages[n++];
      };
    };
    it(`${field}: accepts empty terminal page`, async () => {
      expect(await readMarginHistory("/margin/test", field, reader([page("")]))).toEqual([]);
    });
    it(`${field}: rejects capped partial history`, async () => {
      await expect(readMarginHistory("/margin/test", field, reader(["a", "b", "c", "d", "e"].map((c) => page(c))))).rejects.toThrow(/page limit/);
    });
    it(`${field}: accepts terminal fifth page`, async () => {
      expect(await readMarginHistory("/margin/test", field, reader(["a", "b", "c", "d", ""].map((c) => page(c))))).toEqual([]);
    });
    for (const cursors of [["a", "a"], ["a", "b", "a"]]) {
      it(`${field}: rejects cursor cycle ${cursors.join("-")}`, async () => {
        await expect(readMarginHistory("/margin/test", field, reader(cursors.map((c) => page(c))))).rejects.toThrow(/cursor cycle/);
      });
    }
    for (const [n, cursor] of [undefined, null, 0, false, {}, []].entries()) {
      it(`${field}: rejects malformed cursor ${n}`, async () => {
        await expect(readMarginHistory("/margin/test", field, reader([page(cursor)]))).rejects.toThrow(/cursor/);
      });
    }
    for (const [n, items] of [undefined, null, {}, "not-array"].entries()) {
      it(`${field}: rejects malformed array ${n}`, async () => {
        await expect(readMarginHistory("/margin/test", field, reader([{ status: 200, body: { [field]: items, cursor: "" } }]))).rejects.toThrow(/array/);
      });
    }
    for (const [n, item] of [null, [], {}, { [key]: "" }, { [key]: 2 }].entries()) {
      it(`${field}: rejects malformed record or ID ${n}`, async () => {
        await expect(readMarginHistory("/margin/test", field, reader([page("", [item])]))).rejects.toThrow(/record|identity/);
      });
    }
    it(`${field}: deduplicates identical records independent of key order`, async () => {
      const result = await readMarginHistory("/margin/test", field, reader([page("a", [{ [key]: "one", count: "1" }]), page("", [{ count: "1", [key]: "one" }])]));
      expect(result).toHaveLength(1);
    });
    it(`${field}: rejects conflicting duplicate identity`, async () => {
      await expect(readMarginHistory("/margin/test", field, reader([page("a", [{ [key]: "one", count: "1" }]), page("", [{ [key]: "one", count: "2" }])]))).rejects.toThrow(/conflicting duplicate/);
    });
    it(`${field}: rejects HTTP error after first valid page`, async () => {
      await expect(readMarginHistory("/margin/test", field, reader([page("a"), { status: 503, body: {} }]))).rejects.toThrow(/http 503/);
    });
    it(`${field}: preserves filters and encodes cursor`, async () => {
      const paths: string[] = [];
      await readMarginHistory("/margin/test?ticker=BTC&min_ts=1", field, async (path) => {
        paths.push(path);
        return page(paths.length === 1 ? "a&b /" : "");
      });
      expect(paths).toEqual(["/margin/test?ticker=BTC&min_ts=1", "/margin/test?ticker=BTC&min_ts=1&cursor=a%26b%20%2F"]);
    });
  }
});

describe("portfolio reads preserve unknown versus flat", () => {
  for (const field of ["positions", "exit_triggers"] as const) {
    it(`${field}: accepts explicit empty array`, async () => {
      expect(await readMarginArray("/mock", field, async () => ({ status: 200, body: { [field]: [] } }))).toEqual([]);
    });
    for (const [n, body] of [null, [], {}, { [field]: null }, { [field]: {} }].entries()) {
      it(`${field}: refuses malformed response ${n}`, async () => {
        await expect(readMarginArray("/mock", field, async () => ({ status: 200, body }))).rejects.toThrow(/malformed/);
      });
    }
    it(`${field}: propagates read failure`, async () => {
      await expect(readMarginArray("/mock", field, async () => { throw new Error("mock read failed"); })).rejects.toThrow("mock read failed");
    });
    it(`${field}: refuses HTTP failure despite valid-looking array`, async () => {
      await expect(readMarginArray("/mock", field, async () => ({ status: 503, body: { [field]: [] } }))).rejects.toThrow(/503/);
    });
  }
  const validPosition = { market_ticker: "KXBTCPERP", position: "-1.25", entry_price: "8.360000", unrealized_pnl: "-0.120000", fees: "0.01" };
  for (const [n, value] of [undefined, null, "", " ", "NaN", "Infinity", "1e3", false, 0].entries()) {
    it(`position is not guessed from malformed value ${n}`, () => {
      expect(() => mapMarginPosition({ ...validPosition, position: value })).toThrow(/position/);
    });
  }
  it("accepts an explicit flat position", () => {
    expect(mapMarginPosition({ ...validPosition, position: "0.00" }).position).toBe("0.00");
  });
  for (const key of ["entry_price", "unrealized_pnl", "fees"] as const) {
    it(`does not invent missing ${key}`, () => {
      expect(() => mapMarginPosition({ ...validPosition, [key]: undefined })).toThrow(key);
    });
  }
});

describe("position scaled-integer representability guard", () => {
  const valid = { market_ticker: "KXBTCPERP", position: "0.01", entry_price: "0.000001", unrealized_pnl: "-0.000001", fees: "0.000001" };
  it("accepts signed counts and minimum supported decimal units", () => {
    expect(mapMarginPosition(valid)).toEqual(valid);
    expect(mapMarginPosition({ ...valid, position: "-0.01" }).position).toBe("-0.01");
  });
  for (const sign of ["", "-"]) {
    it(`retains a boundary representable scaled dollar string with sign ${sign || "positive"}`, () => {
      const value = `${sign}9007199254.740991`;
      expect(mapMarginPosition({ ...valid, unrealized_pnl: value }).unrealized_pnl).toBe(value);
    });
    it(`rejects scaled dollars outside the safe integer range with sign ${sign || "positive"}`, () => {
      expect(() => mapMarginPosition({ ...valid, unrealized_pnl: `${sign}9007199254.740992` })).toThrow(/unsafe/);
    });
  }
  it("rejects a huge finite fractional position", () => {
    expect(() => mapMarginPosition({ ...valid, position: "9007199254740992.01" })).toThrow(/unsafe/);
  });
  for (const [key, value] of [["position", "0.001"], ["fees", "0.0000001"]]) {
    it(`rejects excess precision for ${key}`, () => {
      expect(() => mapMarginPosition({ ...valid, [key]: value })).toThrow(/invalid/);
    });
  }
});
