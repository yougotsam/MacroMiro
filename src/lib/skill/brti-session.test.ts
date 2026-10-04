import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { apply, backoffMs, controlFrame, emptySession, fold5, parseFrame, publicStatus, quarterSettlement } from "./brti-session.ts";

const now = 1_710_000_000_000;

function frame(trailing: string, quarter: string, time = now, index = "BRTI") {
  return {
    type: "cfbenchmarks_value",
    msg: {
      index_id: index,
      received_at: time,
      data: JSON.stringify({ type: "value", id: index, time, value: trailing }),
      avg_60s_data: { value: trailing, window_size: 60, window_start_ts_ms: time - 60_000, window_end_ts_exclusive: time },
      last_60s_windowed_average_15min: { value: quarter, window_size: 14, window_start_ts_ms: time - 840_000, window_end_ts_exclusive: time },
    },
  };
}

describe("BRTI session", () => {
  it("keeps the 60-second average apart from the 15-minute window", () => {
    const parsed = parseFrame(frame("68000.12", "68010.50"), now);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.obs.trailing60?.value, 68000.12);
    assert.equal(parsed.obs.windowed15?.value, 68010.5);
    assert.notEqual(parsed.obs.trailing60?.value, parsed.obs.windowed15?.value);
  });

  it("keeps an ETH frame off the bitcoin parser and accepts it on the ETH parser", () => {
    const eth = frame("3000.5", "3001", now, "ETHUSD_RTI");
    assert.equal(parseFrame(eth, now).ok, false);
    const parsed = parseFrame(eth, now, "replay", "ETHUSD_RTI");
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.obs.symbol, "ETHUSD_RTI");
    assert.equal(parseFrame(eth, now, "replay", "SOLUSD_RTI").ok, false);
  });

  it("rejects a bad frame and a non-BRTI symbol", () => {
    assert.equal(parseFrame({ msg: {} }, now).ok, false);
    const other = parseFrame(frame("1", "1", now, "ETHUSD_RTI"), now);
    assert.equal(other.ok, false);
    if (!other.ok) assert.equal(other.category, "unsupported-symbol");
  });

  it("ignores a duplicate and an old timestamp, and records a gap instead of a flat candle", () => {
    let s = apply(emptySession(), { type: "frame", raw: frame("100", "90", now), mode: "replay" }, now);
    s = apply(s, { type: "frame", raw: frame("100", "90", now), mode: "replay" }, now + 10);
    assert.equal(s.ignoredDuplicate, 1);
    s = apply(s, { type: "frame", raw: frame("101", "90", now - 120_000), mode: "replay" }, now + 20);
    assert.equal(s.ignoredOutOfOrder, 1);
    s = apply(s, { type: "frame", raw: frame("110", "90", now + 180_000), mode: "replay" }, now + 180_000);
    assert.ok(s.gaps.length >= 1);
    assert.equal(s.bars.some((b) => b.t === Math.floor((now + 60_000) / 60_000) * 60 && b.o === 100), false);
  });

  it("turns live into stale when the prints stop, and reconnects without a second subscription", () => {
    let s = apply(emptySession(), { type: "frame", raw: frame("100", "90"), mode: "live" }, now);
    assert.equal(s.status, "live");
    s = apply(s, { type: "tick" }, now + 6_000);
    assert.equal(s.status, "stale");
    s = apply(s, { type: "subscribed" }, now);
    s = apply(s, { type: "subscribed" }, now);
    assert.equal(s.subscriptions, 1);
    s = apply(s, { type: "closed" }, now);
    s = apply(s, { type: "connecting" }, now);
    assert.equal(s.status, "reconnecting");
    assert.equal(s.subscribed, false);
  });

  it("does not mix a mock print into a live series", () => {
    let s = apply(emptySession(), { type: "frame", raw: frame("100", "90"), mode: "live" }, now);
    const bars = s.bars.length;
    s = apply(s, { type: "frame", raw: frame("50", "40", now + 60_000), mode: "mock" }, now + 60_000);
    assert.equal(s.lastError, "mock-rejected");
    assert.equal(s.bars.length, bars);
    assert.equal(s.mode, "live");
  });

  it("withholds volatility until five closed minutes exist, then builds 5-minute bars", () => {
    let s = emptySession();
    for (let i = 0; i < 4; i += 1) {
      const t = now + i * 60_000;
      s = apply(s, { type: "frame", raw: frame(String(100 + i), "90", t), mode: "replay" }, t);
    }
    assert.equal(s.volBps, null);
    for (let i = 4; i < 26; i += 1) {
      const t = now + i * 60_000;
      s = apply(s, { type: "frame", raw: frame(String(100 + (i % 3)), "90", t), mode: "replay" }, t);
    }
    assert.equal(typeof s.volBps, "number");
    assert.ok(fold5(s.bars).length >= 1);
    assert.equal(publicStatus(s, now + 26 * 60_000).settlement, "accumulating");
    assert.equal(publicStatus(s, now + 26 * 60_000).settlementValue, null);
    assert.equal(quarterSettlement({ value: 90, windowStart: now, windowEnd: now, windowSize: 14 }), null);
    assert.equal(quarterSettlement({ value: 90, windowStart: now, windowEnd: now, windowSize: 60 }), 90);
    const dumped = JSON.stringify(publicStatus(s, now));
    assert.doesNotMatch(dumped, /PRIVATE KEY|KALSHI-ACCESS-SIGNATURE/);
  });

  it("does not treat a subscribe acknowledgement as a price", () => {
    assert.equal(controlFrame({ type: "subscribed", msg: { channel: "cfbenchmarks_value", sid: 1 } }), "ack");
    assert.equal(controlFrame(frame("1", "2")), "value");
  });

  it("backs off and never claims a fixture is a healthy live feed", () => {
    assert.ok(backoffMs(0, () => 0) >= 500);
    assert.ok(backoffMs(10, () => 0) <= 30_250);
    const s = apply(emptySession(), { type: "frame", raw: frame("100", "90"), mode: "replay" }, now);
    assert.equal(publicStatus(s, now).healthy, false);
    assert.equal(publicStatus(s, now).status, "replay");
  });

  it("the heart GET and the BRTI GET do not call an order", () => {
    const heart = readFileSync(new URL("../../routes/api/live/heart.ts", import.meta.url), "utf8");
    const getBlock = heart.slice(heart.indexOf("GET:"), heart.indexOf("POST:"));
    assert.doesNotMatch(getBlock, /tickHeart|submitBinary|executeHeart|ensureBrti/);
    const brti = readFileSync(new URL("../../routes/api/live/brti.ts", import.meta.url), "utf8");
    assert.doesNotMatch(brti, /tickHeart|submitBinary|kalshi-order|executeHeart/);
    const socket = readFileSync(new URL("./brti-socket.server.ts", import.meta.url), "utf8");
    assert.doesNotMatch(socket, /submitBinary|tickHeart|placeEventOrder/);
  });
});
