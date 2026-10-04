import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { edgeDecision, reasonDead, type EdgeIn } from "./edge.ts";
import { inEventBlackout } from "./blackout.ts";
import { NOT_LIVE_YET, SETTLED_REPLAY } from "./replay-fixture.ts";
import { appendLedger, readLedger } from "../envelope/ledger.server.ts";
import { readKill, setArmedKill, beginFlagOn, liveExecutionAllowed, liveFlagOn } from "../envelope/kill.server.ts";
import { reconcileOrder } from "./kalshi-order-status.ts";

function base(over: Partial<EdgeIn> = {}): EdgeIn {
  return {
    book: "btc",
    status: "active",
    leftSec: 400,
    openTs: 1_000,
    closeTs: 1_900,
    now: 1_400,
    beat: 100,
    spot: 100.2,
    spotSource: "cf-brti-60s",
    rules: "CF Benchmarks' BRTI sixty seconds average",
    yesAsk: 0.35,
    yesBid: 0.33,
    noAsk: 0.67,
    volBps1m: 4,
    tapeOk: true,
    newsOk: true,
    bookImb: 0.2,
    rsi: 55,
    bbWidth: 0.03,
    fibZone: "none",
    ema7: 0.6,
    ema14: 0.55,
    bias30: "up",
    push: true,
    fresh: true,
    ...over,
  };
}

describe("pilot acceptance", () => {
  it("rejects binance and perp as BTC settlement", () => {
    assert.equal(edgeDecision(base({ spotSource: "binance-us" })).take, false);
    assert.equal(edgeDecision(base({ spotSource: "kalshi-perp" })).take, false);
    assert.match(edgeDecision(base({ spotSource: "kalshi-perp" })).why, /cf-brti-60s/);
    const eth = edgeDecision(
      base({
        book: "eth",
        spotSource: "cf-eth-60s",
        rules: "CF Benchmarks' ETHUSD RTI sixty seconds average",
        beat: 3000,
        spot: 3002,
      }),
    );
    assert.equal(eth.settlement, "cf-eth-60s");
    assert.equal(eth.strategy, "eth-rti-vol-book");
  });

  it("does not sit just because news or the book failed to load", () => {
    assert.equal(edgeDecision(base({ tapeOk: false, fresh: false })).take, false);
    assert.doesNotMatch(edgeDecision(base({ newsOk: false })).why, /news unknown/);
    assert.equal(edgeDecision(base({ now: 5_000 })).take, false);
    assert.equal(edgeDecision(base({ bookImb: null, bias30: "up", push: true })).take, true);
    assert.equal(edgeDecision(base({ status: "closed" })).take, false);
  });

  it("replays settled windows without using the result as a probability", () => {
    let takes = 0;
    for (const row of SETTLED_REPLAY) {
      const out = edgeDecision(
        base({
          book: row.book,
          spotSource: row.book === "btc" ? "kalshi-perp" : "none",
          rules: row.rules,
          yesAsk: 0.55,
        }),
      );
      if (out.take) takes += 1;
      assert.notEqual(out.modelP, row.result === "yes" ? 1 : 0);
      assert.equal(out.strategy, row.book === "btc" ? "btc-brti-vol-book" : "gold-pyth-vol-book");
    }
    assert.equal(takes, 0);
  });

  it("does not trade on indicators that are not in the live gate yet", () => {
    const src = readFileSync(new URL("./edge.ts", import.meta.url), "utf8");
    const body = src.slice(src.indexOf("export function edgeDecision"));
    for (const name of NOT_LIVE_YET) assert.doesNotMatch(body, new RegExp(name));
  });

  it("kill switch survives a write and a reread", () => {
    const before = readKill().armed;
    setArmedKill(true, "accept-persist");
    const again = readKill();
    assert.equal(again.armed, true);
    assert.equal(again.liveEnabled, liveFlagOn());
    assert.equal(liveExecutionAllowed(), liveFlagOn() && beginFlagOn());
    setArmedKill(before, "accept-restore");
  });

  it("ledger row survives a reread and fills must match order_id", () => {
    const row = appendLedger({ kind: "scan", note: "accept-replay-not-an-order", mode: "scan" });
    const found = readLedger(20).some((r) => r.note === row.note && r.strategy_version === row.strategy_version);
    assert.equal(found, true);
    assert.equal(reconcileOrder(null, "abc", "executed", 1).ok, false);
    assert.equal(reconcileOrder("abc", "abc", "unknown", 0).ok, false);
    assert.equal(reconcileOrder("abc", "abc", "executed", 1).why, "filled");
    assert.equal(reconcileOrder("abc", "xyz", "executed", 1).ok, false);
  });

  it("GET heart cannot execute and POST tick is not executeHeart", () => {
    const route = readFileSync(new URL("../../routes/api/live/heart.ts", import.meta.url), "utf8");
    const get = route.slice(route.indexOf("GET:"), route.indexOf("POST:"));
    assert.match(get, /loadHeart\(\)/);
    assert.doesNotMatch(get, /tickHeart|executeHeart|kalshiPost|placeEventOrder/);
    const heart = readFileSync(new URL("../envelope/heart.server.ts", import.meta.url), "utf8");
    assert.match(heart, /tickHeartInner\(false\)/);
    assert.match(heart, /const canExecute = execute && liveExecutionAllowed\(\)/);
    const order = readFileSync(new URL("./kalshi-order.ts", import.meta.url), "utf8");
    assert.match(order, /client_order_id: id/);
    assert.match(order, /const clientOrderId = randomUUID\(\)/);
  });
  it("holds a filled ticket to the clock", () => {
    assert.equal(reasonDead("down", 101, 100, false), false);
    assert.equal(reasonDead("up", 99, 100, false), false);
    const heart = readFileSync(new URL("../envelope/heart.server.ts", import.meta.url), "utf8");
    assert.doesNotMatch(heart, /closeEventPosition|price crossed the line/);
  });

  it("buys a 25 to 45 cent push and skips a 62 cent coin flip", () => {
    const push = edgeDecision(base());
    assert.equal(push.take, true);
    assert.equal(push.leg, "up");
    assert.equal(push.cross, true);
    const expensive = edgeDecision(base({ yesAsk: 0.62, yesBid: 0.6, noAsk: 0.4 }));
    assert.equal(expensive.take, false);
    assert.match(expensive.why, /payout not worth it/);
    const quiet = edgeDecision(base({ spot: 100.01, volBps1m: 20, engulf: "up" }));
    assert.equal(quiet.take, false);
  });

  it("skips a ticket outside 25 to 45 cents", () => {
    const cheap = edgeDecision(base({ yesAsk: 0.15, yesBid: 0.13, noAsk: 0.86 }));
    assert.equal(cheap.take, false);
    assert.match(cheap.why, /payout not worth it/);
  });

  it("stands down when the print is still on the line late", () => {
    const mud = edgeDecision(base({ leftSec: 120, spot: 100.02, volBps1m: 20 }));
    assert.equal(mud.take, false);
    assert.match(mud.why, /too close to the line/);
  });

  it("a calendar shock buys the cheap ticket instead of sitting", () => {
    const shot = edgeDecision(base({ blackout: true, yesAsk: 0.32, yesBid: 0.3, noAsk: 0.7 }));
    assert.equal(shot.take, true);
    assert.equal(shot.catalyst, true);
    const rich = edgeDecision(base({ blackout: true, yesAsk: 0.55, yesBid: 0.53, noAsk: 0.47 }));
    assert.equal(rich.take, false);
    assert.equal(inEventBlackout(Date.UTC(2026, 9, 14, 12, 30)), true);
    assert.equal(inEventBlackout(Date.UTC(2026, 9, 14, 14, 0)), false);
  });

  it("counter-trend buys the cheap side when the push stalls", () => {
    const out = edgeDecision(base({ engulf: "down", yesAsk: 0.72, yesBid: 0.7, noAsk: 0.3 }));
    assert.equal(out.take, true);
    assert.equal(out.leg, "down");
    assert.match(out.why, /counter/);
  });

  it("sits the last ninety seconds and can enter the rest of the window", () => {
    assert.match(edgeDecision(base({ leftSec: 20 })).why, /outside entry window/);
    assert.match(edgeDecision(base({ leftSec: 890 })).why, /outside entry window/);
    assert.doesNotMatch(edgeDecision(base({ leftSec: 400 })).why, /outside entry window/);
    assert.doesNotMatch(edgeDecision(base({ leftSec: 870 })).why, /outside entry window/);
  });

  it("writes the fee on the note and does not use it as the decision", () => {
    const a = edgeDecision(base());
    const b = edgeDecision(base());
    assert.equal(a.why, b.why);
    assert.ok(a.fee != null && a.fee > 0);
    assert.doesNotMatch(a.why, /net /);
    assert.match(a.why, /index /);
  });

  it("does not hardcode an expired ticker", () => {
    const src = readFileSync(new URL("./kalshi.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /KXBTC15M-26SEP220100/);
    assert.match(src, /status=open/);
  });

  it("ledger is not /tmp", () => {
    const src = readFileSync(new URL("../envelope/ledger.server.ts", import.meta.url), "utf8");
    assert.match(src, /\/workspace\/data/);
    assert.match(src, /ledger\.jsonl/);
    assert.doesNotMatch(src, /\/tmp\//);
  });

  it("daily loss cap is $24 and an order needs both switches", () => {
    const kill = readFileSync(new URL("../envelope/kill.server.ts", import.meta.url), "utf8");
    assert.match(kill, /DAILY_LOSS_CAP = 15/);
    assert.match(kill, /executionFromFlags\(liveFlagOn\(\), beginFlagOn\(\)\)/);
    assert.doesNotMatch(kill, /writeFileSync\(BEGIN_FILE/);
  });
});
