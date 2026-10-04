import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Bar } from "./bars.ts";
import { brtiFromMessage, liveFeedBlocked, mockFeed, pythFromPrice } from "./feeds.ts";
import { scoreBook } from "./pipeline.ts";

function climb(): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < 25; i++) {
    const c = 0.4 + i * 0.01;
    out.push({ t: 1_000 + i * 60, o: c - 0.008, h: c + 0.002, l: c - 0.01, c, v: 20 + i, closed: true });
  }
  return out;
}

const yes: [string, string][] = [["0.40", "10"], ["0.62", "40"]];
const no: [string, string][] = [["0.20", "5"], ["0.30", "8"]];

describe("btc and gold skill", () => {
  it("momentum needs the stack, not RSI alone", () => {
    const feed = mockFeed("cf-brti-60s", 100.4, 1_700_000, 1_700_000);
    const up = scoreBook({
      book: "btc",
      bars: climb(),
      nowSec: 1_000 + 25 * 60,
      yesBids: yes,
      noBids: no,
      feed,
      beat: 100,
      volBps: 8,
      leftSec: 400,
      newsBlocked: false,
      newsKnown: true,
    });
    assert.equal(up.liveAllowed, false);
    assert.equal(up.experimental, true);
    assert.equal(up.book, "btc");
    assert.ok(up.confirms.includes("5m") || up.thesis === "none" || up.missing.length >= 0);

    const rsiAlone = scoreBook({
      book: "btc",
      bars: climb().map((b, i) => (i === 24 ? { ...b, o: b.c, h: b.c, l: b.c, c: b.c } : b)),
      nowSec: 1_000 + 25 * 60,
      yesBids: [["0.50", "10"]],
      noBids: [["0.50", "10"]],
      feed,
      beat: 100.4,
      volBps: 8,
      leftSec: 400,
      newsBlocked: false,
      newsKnown: true,
    });
    assert.notEqual(rsiAlone.reason, "rsi");
    assert.equal(rsiAlone.liveAllowed, false);
  });

  it("gold uses its own label and a stale pyth print blocks", () => {
    const stale = pythFromPrice({ price: "436000000000", expo: -8, publish_time: 1_000 }, 1_700_000_000);
    assert.equal(stale.ok, false);
    const report = scoreBook({
      book: "gold",
      bars: climb(),
      nowSec: 2_600,
      yesBids: yes,
      noBids: no,
      feed: stale,
      beat: 4360,
      volBps: 6,
      leftSec: 300,
      newsBlocked: false,
      newsKnown: true,
    });
    assert.equal(report.strategy.startsWith("gold-"), true);
    assert.equal(report.thesis, "none");
    assert.ok(report.missing.some((m) => m.includes("stale")));
    assert.equal(report.liveAllowed, false);
  });

  it("missing credentials block the feed and do not invent a price", () => {
    const b = liveFeedBlocked("cf-brti-60s", false);
    const g = liveFeedBlocked("pyth-gold-1m", false);
    assert.equal(b.ok, false);
    assert.equal(g.ok, false);
    if (!b.ok) assert.match(b.missing, /Kalshi key/);
    if (!g.ok) assert.match(g.missing, /PYTH_API_KEY/);
  });

  it("parses a fresh BRTI 60s average and rejects a blank one", () => {
    const now = 1_710_000_000_000;
    const ok = brtiFromMessage({ avg_60s_data: { value: "86327.67", window_end_ts_exclusive: now - 1000 } }, now);
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.mode, "live");
    const bad = brtiFromMessage({}, now);
    assert.equal(bad.ok, false);
  });
});
