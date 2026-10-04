import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beginFlagOn, executionFromFlags, liveExecutionAllowed, liveFlagOn, readKill, killBlocksTrade } from "./kill.server.ts";
import { eventCancelPath, mayCancel, orderStatusOf } from "../scan/kalshi-order-status.ts";
import { signedPath } from "../scan/kalshi-auth.ts";

describe("P0 live execution", () => {
  it("sends only when the path is on and the session has begun", () => {
    assert.equal(executionFromFlags(false, false), false);
    assert.equal(executionFromFlags(true, false), false);
    assert.equal(executionFromFlags(false, true), false);
    assert.equal(executionFromFlags(true, true), true);
    assert.equal(liveExecutionAllowed(), liveFlagOn() && beginFlagOn());
    assert.equal(readKill().liveEnabled, liveFlagOn());
    const block = killBlocksTrade(0);
    if (!liveFlagOn() || !beginFlagOn()) {
      assert.equal(block.ok, false);
      assert.equal(block.why, liveFlagOn() ? "not begun" : "live path off");
    }
  });
});

describe("event cancel path", () => {
  it("cancels on the event-order route for shard 2 and signs without the query", () => {
    const path = eventCancelPath("abc-1", "KXBTC15M-TEST");
    assert.match(path, /^\/trade-api\/v2\/portfolio\/events\/orders\/abc-1\?/);
    assert.match(path, /exchange_index=2/);
    assert.match(path, /market_ticker=KXBTC15M-TEST/);
    assert.equal(signedPath(path), "/trade-api/v2/portfolio/events/orders/abc-1");
    const src = readFileSync(new URL("../scan/kalshi-order.ts", import.meta.url), "utf8");
    assert.match(src, /eventCancelPath/);
    assert.match(src, /immediate_or_cancel/);
    assert.match(src, /post_only: false/);
    assert.doesNotMatch(src, /post_only: true/);
    assert.doesNotMatch(src, /kalshiDelete\(`\/trade-api\/v2\/portfolio\/orders\//);
  });
});

describe("GTC cancel guard", () => {
  it("must not cancel a filled order", () => {
    assert.equal(mayCancel("executed", 6), false);
    assert.equal(mayCancel("filled", 1), false);
    assert.equal(mayCancel("canceled", 0), false);
  });

  it("may cancel only confirmed open rest with zero fill", () => {
    assert.equal(mayCancel("resting", 0), true);
    assert.equal(mayCancel("open", 0), true);
    assert.equal(mayCancel("unknown", 0), false);
    assert.equal(mayCancel("resting", 2), false);
  });

  it("parses wrapped order payloads", () => {
    const s = orderStatusOf({ order: { status: "executed", fill_count_fp: "2.00", remaining_count_fp: "0.00" } });
    assert.equal(s.status, "executed");
    assert.equal(s.fill, 2);
    assert.equal(s.remaining, 0);
  });
});
