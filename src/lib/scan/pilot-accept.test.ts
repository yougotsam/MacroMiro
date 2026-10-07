import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { edgeDecision, reasonDead, type EdgeIn } from "./edge.ts";
import { scanLines, type UpDownRound } from "./updown.ts";
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
    ema7: 99.5,
    ema14: 99,
    ema20: 99.5,
    ema50: 99,
    rejection: null,
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

  it("buys inside 4 to 75 cents and skips a price outside that band", () => {
    const push = edgeDecision(base());
    assert.equal(push.take, true);
    assert.equal(push.leg, "up");
    assert.equal(push.cross, true);
    assert.equal(push.clipScale, 1);
    assert.equal(edgeDecision(base({ yesAsk: 0.04, yesBid: 0.03, noAsk: 0.97 })).take, true);
    assert.equal(edgeDecision(base({ yesAsk: 0.55, yesBid: 0.4, noAsk: 0.6 })).take, true);
    assert.equal(edgeDecision(base({ yesAsk: 0.75, yesBid: 0.7, noAsk: 0.3 })).take, true);
    const expensive = edgeDecision(base({ yesAsk: 0.76, yesBid: 0.74, noAsk: 0.26 }));
    assert.equal(expensive.take, false);
    assert.match(expensive.why, /payout not worth it/);
    const hot = edgeDecision(base({ rsi: 85 }));
    assert.equal(hot.take, false);
    assert.match(hot.why, /RSI overbought/);
    assert.match(edgeDecision(base({ yesBid: 0 })).why, /no quote/);
  });

  it("skips a ticket under 4 cents", () => {
    const cheap = edgeDecision(base({ yesAsk: 0.03, yesBid: 0.02, noAsk: 0.98 }));
    assert.equal(cheap.take, false);
    assert.match(cheap.why, /payout not worth it/);
  });

  it("buys a cheap YES on an oversold wick and sits a bare RSI print", () => {
    const snipe = edgeDecision(
      base({ spot: 99.4, rsi: 28, rejection: "up", yesAsk: 0.08, yesBid: 0.06, noAsk: 0.94, ema20: 100.2, ema50: 100.4 }),
    );
    assert.equal(snipe.take, true);
    assert.equal(snipe.leg, "up");
    assert.match(snipe.why, /RSI bounce at 28/);
    const bare = edgeDecision(base({ spot: 99.4, rsi: 28, ema20: 100.2, ema50: 100.4 }));
    assert.equal(bare.take, false);
    assert.match(bare.why, /no structure|RSI oversold/);
    const fade = edgeDecision(base({ rsi: 78, engulf: "down", yesAsk: 0.7, yesBid: 0.68, noAsk: 0.32 }));
    assert.equal(fade.take, true);
    assert.equal(fade.leg, "down");
    assert.match(fade.why, /RSI fade at 78/);
  });

  it("stands down when the print is still on the line in the last minute", () => {
    const mud = edgeDecision(base({ leftSec: 50, spot: 100.02, volBps1m: 20 }));
    assert.equal(mud.take, false);
    assert.match(mud.why, /too close to the line/);
  });

  it("a calendar shock uses the same price band and does not sit", () => {
    const shot = edgeDecision(base({ blackout: true, yesAsk: 0.32, yesBid: 0.3, noAsk: 0.7 }));
    assert.equal(shot.take, true);
    assert.equal(shot.catalyst, true);
    const rich = edgeDecision(base({ blackout: true, yesAsk: 0.76, yesBid: 0.74, noAsk: 0.26 }));
    assert.equal(rich.take, false);
    assert.equal(inEventBlackout(Date.UTC(2026, 9, 14, 12, 30)), true);
    assert.equal(inEventBlackout(Date.UTC(2026, 9, 14, 14, 0)), false);
  });

  it("follows the print even when the last candle flips", () => {
    const out = edgeDecision(base({ engulf: "down", yesAsk: 0.55, yesBid: 0.53, noAsk: 0.47 }));
    assert.equal(out.take, true);
    assert.equal(out.leg, "up");
    assert.equal(out.clipScale, 1);
  });

  it("buys the side of the line against the 30-minute lean at half clip", () => {
    const dip = edgeDecision(base({ spot: 99.8, yesAsk: 0.62, yesBid: 0.6, noAsk: 0.4, ema20: 99.95, ema50: 100.2, rsi: 45 }));
    assert.equal(dip.take, true);
    assert.equal(dip.leg, "down");
    assert.equal(dip.clipScale, 0.5);
    assert.match(dip.why, /half clip/);
    const flat = edgeDecision(base({ bias30: "flat" }));
    assert.equal(flat.take, true);
    assert.equal(flat.leg, "up");
    assert.equal(flat.clipScale, 0.5);
  });

  it("does not sit on zero volume, and a perp mark is only a tape when the flag says so", () => {
    assert.equal(edgeDecision(base({ volume: 0 })).take, true);
    assert.equal(edgeDecision(base({ volume: null })).take, true);
    const bare = edgeDecision(base({ spotSource: "kalshi-perp" }));
    assert.equal(bare.take, false);
    const bridge = edgeDecision(base({ spotSource: "kalshi-perp", fallback: true }));
    assert.equal(bridge.take, true);
    assert.equal(bridge.clipScale, 0.5);
    assert.equal(bridge.settlement, "cf-brti-60s");
    assert.match(bridge.why, /perp tape/);
    assert.equal(edgeDecision(base({ spotSource: "binance-us", fallback: true })).take, false);
  });

  it("sits the first 5 seconds and the last 30 seconds", () => {
    assert.match(edgeDecision(base({ leftSec: 25 })).why, /outside entry window/);
    assert.match(edgeDecision(base({ leftSec: 896 })).why, /outside entry window/);
    assert.doesNotMatch(edgeDecision(base({ leftSec: 45 })).why, /outside entry window/);
    assert.doesNotMatch(edgeDecision(base({ leftSec: 890 })).why, /outside entry window/);
    assert.match(edgeDecision(base({ volBps1m: 201 })).why, /volatility extreme/);
    assert.match(edgeDecision(base({ rsi: null, ema20: null, ema50: null })).why, /indicators unread/);
    const heart = readFileSync(new URL("../envelope/heart.server.ts", import.meta.url), "utf8");
    assert.match(heart, /leftSec <= 30/);
    assert.doesNotMatch(heart, /leftSec < 90/);
    assert.match(heart, /yes < 0\.04 \|\| yes > 0\.75/);
    assert.match(heart, /clipScale === 0\.5 \? 0\.5 : 1/);
    assert.match(heart, /scanLines\(round\)/);
  });

  it("names the sit gate and never blames volume or the lean", () => {
    const row: UpDownRound = {
      slug: "KXBTC15M-26OCT07-B67250",
      ticker: "KXBTC15M-26OCT07-B67250",
      question: "",
      url: "",
      start: 0,
      end: 0,
      leftSec: 400,
      beat: 67250,
      spot: 67284.1,
      moveBps: 5,
      up: 0.53,
      down: 0.48,
      yesBid: 0.48,
      winner: "up",
      decided: true,
      take: true,
      leg: "up",
      chip: "settle-ta",
      reason: "with up",
      venue: "kalshi",
      book: "btc",
      volBps1m: 6.32,
      bias30: "up",
      clipScale: 1,
    };
    const lines = scanLines(row);
    assert.match(lines[0], /Delta: \+\$34\.10/);
    assert.match(lines[1], /Threshold: \$21\.25/);
    assert.match(lines[1], /Push: CLEAR \(\+1\.60x\)/);
    assert.match(lines[2], /YES 48¢ bid \/ 53¢ ask \(Spread: 5¢\)/);
    assert.match(lines[2], /Lean\(30m\): UP \(Match -> 1\.0x Clip\)/);
    assert.match(lines[3], /QUALIFIED/);
    assert.doesNotMatch(lines.join("\n"), /volume_zero|lean_mismatch/);
    const under = scanLines({ ...row, take: false, spot: 67262, reason: "not clearing the line", missing: "not clearing the line" });
    assert.match(under[3], /SIT: delta_under_noise \(\$12\.00 < \$21\.25\)/);
    const against = scanLines({ ...row, take: false, reason: "SIT: no structure", missing: "SIT: no structure" });
    assert.match(against[3], /SIT: no_structure/);
    assert.doesNotMatch(scanLines(row).join("\n"), /spread_wide/);
    const edge = scanLines({ ...row, take: false, leftSec: 20, reason: "outside entry window", missing: "outside entry window" });
    assert.match(edge[3], /SIT: window_boundary/);
    const late = scanLines({
      ...row,
      take: false,
      leftSec: 45,
      spot: 67284.1,
      reason: "too close to the line",
      missing: "too close to the line",
    });
    assert.match(late[3], /SIT: delta_under_noise \(\$34\.10 < \$42\.50\)/);
    assert.doesNotMatch(late[3], /\$34\.10 < \$21\.25/);
    const down = scanLines({ ...row, leg: "down", spot: 67200, up: 0.16, yesBid: 0.15, down: 0.85 });
    assert.match(down[2], /NO 84¢ bid \/ 85¢ ask/);
    const blow = scanLines({ ...row, take: false, reason: "volatility extreme", missing: "volatility extreme" });
    assert.match(blow[3], /SIT: volatility_extreme \(>200bps\)/);
  });

  it("writes the fee on the note and does not use it as the decision", () => {
    const a = edgeDecision(base());
    const b = edgeDecision(base());
    assert.equal(a.why, b.why);
    assert.ok(a.fee != null && a.fee > 0);
    assert.doesNotMatch(a.why, /net /);
    assert.match(a.why, /20-EMA/);
    assert.match(a.why, /fee /);
  });

  it("does not hardcode an expired ticker", () => {
    const src = readFileSync(new URL("./kalshi.ts", import.meta.url), "utf8");
    assert.doesNotMatch(src, /KXBTC15M-26SEP220100/);
    assert.match(src, /status=open/);
    assert.match(src, /ticker: live\.ticker/);
    assert.doesNotMatch(src, /KXBTC15M-\$\{/);
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
