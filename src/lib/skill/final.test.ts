import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readBrti, settlementPrint, spotForDistance } from "./brti.ts";
import { nextBook, reuseClientId } from "./book-seq.ts";
import { readNews } from "./news-read.ts";
import { estimateProb } from "./prob.ts";
import { finalize } from "./bars.ts";

const now = 1_710_000_000_000;

describe("finalization", () => {
  it("does not treat the trailing 60s average as the quarter-hour settlement", () => {
    const read = readBrti(
      {
        index_id: "BRTI",
        received_at: now,
        data: JSON.stringify({ type: "value", id: "BRTI", time: now, value: "86000" }),
        avg_60s_data: { value: "86100", window_size: 60, window_start_ts_ms: now - 60_000, window_end_ts_exclusive: now - 500 },
        last_60s_windowed_average_15min: { value: "85900", window_size: 14, window_start_ts_ms: now - 840_000, window_end_ts_exclusive: now - 500 },
      },
      now,
    );
    assert.equal(spotForDistance(read), 86100);
    assert.equal(settlementPrint(read, false), null);
    assert.equal(settlementPrint(read, true), null);
    const closed = readBrti(
      {
        index_id: "BRTI",
        received_at: now,
        data: JSON.stringify({ type: "value", id: "BRTI", time: now, value: "86000" }),
        avg_60s_data: { value: "86100", window_size: 60, window_start_ts_ms: now - 60_000, window_end_ts_exclusive: now - 500 },
        last_60s_windowed_average_15min: { value: "85900", window_size: 60, window_start_ts_ms: now - 60_000, window_end_ts_exclusive: now - 500 },
      },
      now,
    );
    assert.equal(settlementPrint(closed, true), 85900);
    assert.equal(settlementPrint(closed, false), null);
    assert.notEqual(spotForDistance(closed), settlementPrint(closed, true));
  });

  it("rejects a malformed BRTI message", () => {
    const read = readBrti({ index_id: "BRTI" }, now);
    assert.equal(spotForDistance(read), null);
    assert.ok(read.missing.includes("avg_60s_data"));
  });

  it("drops an open candle and recovers a sequence gap", () => {
    const bars = [
      { t: 0, o: 1, h: 1, l: 1, c: 1, v: 1, closed: true },
      { t: 120, o: 1, h: 1, l: 1, c: 1, v: 1, closed: false },
    ];
    assert.equal(finalize(bars, 90).length, 1);
    const gap = nextBook({ seq: 4, yes: [], no: [] }, { seq: 9, snapshot: false, yes: [["0.5", "1"]], no: [] });
    assert.equal(gap.gap, true);
    assert.equal(gap.recover, true);
    assert.equal(gap.book.seq, 4);
  });

  it("returns null probability when the spot is missing, and labels a number experimental", () => {
    const missing = estimateProb({
      book: "btc",
      regime: "none",
      spot: null,
      beat: 100,
      volBps: 8,
      leftSec: 400,
      yesAsk: 0.55,
      yesBid: 0.53,
      noAsk: 0.47,
      feedOk: false,
      calibrated: false,
    });
    assert.equal(missing.modelPYes, null);
    assert.equal(missing.label, "unavailable");
    const est = estimateProb({
      book: "btc",
      regime: "momentum",
      spot: 100.4,
      beat: 100,
      volBps: 8,
      leftSec: 400,
      yesAsk: 0.55,
      yesBid: 0.53,
      noAsk: 0.47,
      feedOk: true,
      calibrated: false,
      bullish: ["distance"],
      bearish: [],
    });
    assert.equal(est.label, "Experimental estimate");
    assert.equal(est.confidence, "experimental");
    assert.ok(est.noTrade.includes("not calibrated"));
    assert.notEqual(est.modelPYes, 0.55);
  });

  it("news explains the print and still cannot trade", () => {
    const n = readNews(
      {
        name: "CPI y/y",
        time: "2026-09-22T12:30:00.000Z",
        forecast: "2.9",
        previous: "2.7",
        actual: "3.1",
        sourceUrl: "https://www.forexfactory.com/calendar",
      },
      true,
    );
    assert.equal(n.surprise, "above");
    assert.equal(n.expected, "down");
    assert.equal(n.trade, false);
    assert.equal(n.veto, true);
    const gone = readNews(null, false);
    assert.equal(gone.veto, true);
    assert.match(gone.event, /missing/);
  });

  it("reuses a client id only while the order is unknown or open", () => {
    assert.equal(reuseClientId({ ticker: "KXBTC15M-X", clientOrderId: "abc", status: "unknown" }, "KXBTC15M-X"), "abc");
    assert.equal(reuseClientId({ ticker: "KXBTC15M-X", clientOrderId: "abc", status: "canceled" }, "KXBTC15M-X"), null);
  });

  it("GET heart source still cannot execute", () => {
    const route = readFileSync(new URL("../../routes/api/live/heart.ts", import.meta.url), "utf8");
    const get = route.slice(route.indexOf("GET:"), route.indexOf("POST:"));
    assert.match(get, /loadHeart\(\)/);
    assert.doesNotMatch(get, /tickHeart|executeHeart|placeEventOrder/);
    const rules = readFileSync(new URL("../../../.grok/rules/trading-system.md", import.meta.url), "utf8");
    assert.match(rules, /last_60s_windowed_average_15min/);
    assert.match(rules, /Experimental estimate/);
  });
});
