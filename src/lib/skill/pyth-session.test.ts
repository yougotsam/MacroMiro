import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyXau, emptyXau, lastCandleClose, parsePyth, xauStatus, XAU_TICKER } from "./pyth-session.ts";

const now = 1_710_000_060_000;

function tick(px: number, ts: number) {
  return {
    type: "pyth_value",
    msg: { underlying_ticker: XAU_TICKER, value_usd: px.toFixed(8), source_ts_ms: ts, received_at: ts },
  };
}

describe("XAU session", () => {
  it("keeps a live tick out of the finished candle", () => {
    let s = applyXau(emptyXau(), { type: "tick", px: 4300, ts: now }, now);
    s = applyXau(s, { type: "tick", px: 4302, ts: now + 10_000 }, now + 10_000);
    assert.equal(s.last, 4302);
    assert.equal(lastCandleClose(s), null);
    assert.equal(xauStatus(s, now + 10_000).settlement, "absent");
    s = applyXau(s, { type: "tick", px: 4305, ts: now + 60_000 }, now + 60_000);
    assert.equal(lastCandleClose(s), 4302);
    assert.notEqual(lastCandleClose(s), s.last);
  });

  it("ignores a different metal and a bad frame", () => {
    const other = parsePyth({ msg: { underlying_ticker: "Metal.XAG/USD", value_usd: "30", source_ts_ms: now } });
    assert.equal(other.ok, false);
    assert.equal(parsePyth({ msg: {} }).ok, false);
  });

  it("the pyth route and socket cannot place an order", () => {
    const route = readFileSync(new URL("../../routes/api/live/pyth.ts", import.meta.url), "utf8");
    assert.doesNotMatch(route, /tickHeart|submitBinary|placeEventOrder|kalshiPost|kalshiDelete/);
    const socket = readFileSync(new URL("./pyth-socket.server.ts", import.meta.url), "utf8");
    assert.match(socket, /XAU_TICKER/);
    assert.match(readFileSync(new URL("./pyth-session.ts", import.meta.url), "utf8"), /Metal\.Index\.1OZGOLD\/USD/);
    assert.doesNotMatch(socket, /submitBinary|tickHeart|placeEventOrder/);
  });
});
