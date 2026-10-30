import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { MAX_ORDER_COST_USD, MODEL_VERSION, PRICE_MAX } from "../desk/config";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendDecision, brier, brierBeatsPrice, logLoss, readDecisions, renderDailyReport, type DecisionRow } from "./scorecard";
import { judgeSetup, pctModeInterlock, promotionDocument } from "./promotion";
import { resolutionRider, RIDER_SETUP, type RiderInput } from "./rider";

function row(n: number, over: Partial<DecisionRow> = {}): DecisionRow {
  const y: 0 | 1 = n % 2 === 0 ? 1 : 0;
  return {
    at: n,
    expiryMs: 1_700_000_000_000 + n * 60_000,
    series: "KXBTC15M",
    setup: RIDER_SETUP,
    modelPYes: y === 1 ? 0.8 : 0.2,
    yesPrice: 0.5,
    edge: 0.02,
    mode: "maker",
    featureHash: "abc",
    settledYes: y,
    pnlAfterFees: 0.05,
    fresh: true,
    tteSec: 70,
    filled: false,
    ...over,
  };
}

const goodRider = (): RiderInput => ({
  tteSec: 70,
  favored: "yes",
  favoredPrice: 0.6,
  spread: 0.01,
  tick: 0.01,
  momentum: 12,
  sigma1m: 4,
  ofi: 3,
  lockFrac: 0.8,
  makerEdge: 0.02,
  takerEdge: 0.05,
});

describe("scorecard math", () => {
  it("matches a hand-computed Brier and log loss", () => {
    const rows = [
      { p: 0.8, y: 1 as const },
      { p: 0.2, y: 0 as const },
    ];
    expect(brier(rows)).toBeCloseTo(0.04, 10);
    const eps = 1e-6;
    const p1 = 0.8;
    const p0 = 0.2;
    const hand = -(Math.log(p1) + Math.log(1 - p0)) / 2;
    expect(logLoss(rows.map((r) => ({ p: Math.min(1 - eps, r.p), y: r.y })))).toBeCloseTo(hand, 5);
  });

  it("a constant gap beats the price, and a tied forecast does not", () => {
    const sharp = [row(0), row(1)].map((r) => ({ p: r.modelPYes, price: r.yesPrice, y: r.settledYes as 0 | 1 }));
    expect(brierBeatsPrice(sharp).better).toBe(true);
    const tied = sharp.map((r) => ({ ...r, p: r.price }));
    expect(brierBeatsPrice(tied).better).toBe(false);
  });

  it("writes a daily table", () => {
    const text = renderDailyReport([row(0), row(1)], "2026-10-20");
    expect(text).toContain("resolution-rider");
    expect(text).toContain("0.0400");
    expect(text).toContain("0.2500");
  });

  it("appends a row and reads it back", () => {
    const path = join(mkdtempSync(join(tmpdir(), "score-")), "scorecard.jsonl");
    appendDecision(path, row(0));
    expect(readDecisions(path)).toHaveLength(1);
    expect(readDecisions(path)[0].setup).toBe(RIDER_SETUP);
  });
});

describe("promotion gate", () => {
  const pass = Array.from({ length: 300 }, (_, i) => row(i, { filled: i < 5, pnlAfterFees: 0.05 }));

  it("promotes only when every rule holds", () => {
    expect(judgeSetup(pass, { windowSize: 50, embargoMs: 0 }).state).toBe("ELIGIBLE");
  });

  it("fails a short sample", () => {
    expect(judgeSetup(pass.slice(0, 299), { windowSize: 50, embargoMs: 0 }).why).toContain("299");
  });

  it("fails one stale row", () => {
    const rows = pass.map((r, i) => (i === 10 ? { ...r, fresh: false } : r));
    expect(judgeSetup(rows, { windowSize: 50, embargoMs: 0 }).why).toContain("stale");
  });

  it("fails when the model is worse than the price", () => {
    const rows = pass.map((r) => ({ ...r, modelPYes: r.settledYes === 1 ? 0.2 : 0.8 }));
    expect(judgeSetup(rows, { windowSize: 50, embargoMs: 0 }).why).toContain("95%");
  });

  it("fails a negative after-fee result", () => {
    const rows = pass.map((r) => ({ ...r, pnlAfterFees: -0.2 }));
    expect(judgeSetup(rows, { windowSize: 50, embargoMs: 0 }).why).toContain("EV");
  });

  it("demotes after two bad windows even if the older sample was good", () => {
    const bad = Array.from({ length: 100 }, (_, i) =>
      row(400 + i, { modelPYes: i % 2 === 0 ? 0.2 : 0.8, pnlAfterFees: -0.01, filled: false }),
    );
    const v = judgeSetup([...pass, ...bad], { windowSize: 50, embargoMs: 0 });
    expect(v.state).toBe("RESEARCH");
    expect(v.why).toContain("walk-forward");
  });

  it("refuses percent sizing without a positive fill record", () => {
    expect(pctModeInterlock(null).ok).toBe(false);
    const doc = promotionDocument({ [RIDER_SETUP]: pass.map((r) => ({ ...r, filled: false })) }, 1, MODEL_VERSION, { windowSize: 50, embargoMs: 0 });
    expect(doc.setups[RIDER_SETUP].state).toBe("ELIGIBLE");
    expect(pctModeInterlock(doc).ok).toBe(false);
    const paid = promotionDocument({ [RIDER_SETUP]: pass }, 1, MODEL_VERSION, { windowSize: 50, embargoMs: 0 });
    expect(pctModeInterlock(paid).ok).toBe(true);
    expect(pctModeInterlock(paid).why).toContain("owner");
  });
});

describe("resolution rider", () => {
  it("buys the favorite when momentum, flow, and the spread agree", () => {
    const d = resolutionRider(goodRider());
    expect(d.trade).toBe(true);
    expect(d.mode).toBe("maker");
    expect(d.reasons.momentum).toBe("confirms");
  });

  it("sits when the last minute reverses", () => {
    const d = resolutionRider({ ...goodRider(), momentum: -12 });
    expect(d.trade).toBe(false);
    expect(d.reasons.momentum).toContain("opposes");
  });

  it("sits when the spread widens", () => {
    const d = resolutionRider({ ...goodRider(), spread: 0.03 });
    expect(d.trade).toBe(false);
    expect(d.reasons.spread).toContain("wider");
  });

  it("sits on missing flow unless the move is at least two sigma", () => {
    expect(resolutionRider({ ...goodRider(), ofi: null, momentum: 5, sigma1m: 4 }).trade).toBe(false);
    expect(resolutionRider({ ...goodRider(), ofi: null, momentum: 9, sigma1m: 4 }).trade).toBe(true);
  });

  it("does not raise the price ceiling", () => {
    const d = resolutionRider({ ...goodRider(), favoredPrice: 0.97 });
    expect(d.trade).toBe(false);
    expect(d.reasons.band).toContain(String(PRICE_MAX));
  });

  it("still honors the last-45-second pull", () => {
    expect(resolutionRider({ ...goodRider(), tteSec: 30, lockFrac: 0.4 }).reasons.pull).toContain("lock");
    expect(resolutionRider({ ...goodRider(), tteSec: 30, lockFrac: 0.8 }).trade).toBe(true);
  });

  it("is not imported by the live sender", () => {
    const src = readFileSync(new URL("../desk/evaluator.ts", import.meta.url), "utf8");
    expect(src).not.toContain("deskc/rider");
    expect(src).not.toContain("resolutionRider");
  });
});
