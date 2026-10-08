import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { appendLedger, readLedger } from "../envelope/ledger.server.ts";
import { readKill, recordPnl, saveKill, setArmedKill, beginFlagOn, liveExecutionAllowed, liveFlagOn } from "../envelope/kill.server.ts";
import { reconcileOrder } from "./kalshi-order-status.ts";

describe("pilot acceptance", () => {
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

  it("GET heart cannot execute and POST tick is scan-only", () => {
    const route = readFileSync(new URL("../../routes/api/live/heart.ts", import.meta.url), "utf8");
    const get = route.slice(route.indexOf("GET:"), route.indexOf("POST:"));
    assert.match(get, /loadHeart\(\)/);
    assert.doesNotMatch(get, /tickHeart|executeHeart|kalshiPost|placeEventOrder/);
    assert.doesNotMatch(route, /secrets\/kalshi_begin|writeFileSync|executeHeart/);
    assert.match(route, /mutationGuard\(request\)/);
    const heart = readFileSync(new URL("../envelope/heart.server.ts", import.meta.url), "utf8");
    assert.doesNotMatch(heart, /submitBinary|placeEventOrder|kalshi-order|executeHeart|closeEventPosition/);
  });

  it("three settled losses in a row pause new entries for 60 minutes; a win resets the streak", () => {
    saveKill({ ...readKill(), consecutiveLosses: 0, pauseUntil: 0 });
    recordPnl(-1);
    recordPnl(-1);
    assert.equal(readKill().consecutiveLosses, 2);
    recordPnl(0.5);
    assert.equal(readKill().consecutiveLosses, 0);
    const t0 = Date.now();
    recordPnl(-1);
    recordPnl(-1);
    recordPnl(-1);
    const k = readKill();
    assert.ok(k.pauseUntil >= t0 + 59 * 60_000 && k.pauseUntil <= Date.now() + 60 * 60_000);
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
    assert.match(src, /DATA_ROOT/);
    assert.match(src, /ledger\.jsonl/);
    assert.doesNotMatch(src, /\/tmp\//);
    const root = readFileSync(new URL("../data-root.ts", import.meta.url), "utf8");
    assert.match(root, /"\/workspace\/data"/);
  });

  it("daily loss cap is $15 and an order needs both switches", () => {
    const kill = readFileSync(new URL("../envelope/kill.server.ts", import.meta.url), "utf8");
    assert.match(kill, /DAILY_LOSS_CAP = 15/);
    assert.match(kill, /executionFromFlags\(liveFlagOn\(\), beginFlagOn\(\)\)/);
    assert.doesNotMatch(kill, /writeFileSync\(BEGIN_FILE/);
  });
});
