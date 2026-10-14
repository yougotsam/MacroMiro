import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TIMING_POLICIES, approve, bucketFor, calibrate, loadCalibrator, type Calibrator } from "./approval";
import { APPROVAL_CUSHION, APPROVAL_POLICY_ENFORCED, CALIBRATED_MODEL_APPROVED, TIMING_POLICY } from "./config";
import type { Candidate } from "./gate";

const MODEL = "m+1";
const cal = (over: Partial<Calibrator> = {}): Calibrator => ({
  id: "c1", model: MODEL, method: "platt", a: 1, b: 0,
  fittedOn: { contracts: 600, windows: 120, from: "2026-10-01", to: "2026-10-05" },
  outOfSample: { contracts: 600, windows: 120, brierModel: 0.10, brierMarket: 0.11 },
  approvedBy: "sameer", approvedAt: "2026-10-09T12:00:00Z", ...over,
});
const cand = (over: Partial<Candidate> = {}): Candidate => ({ side: "yes", mode: "taker", price: 0.6, count: 3, fee: 0.06, feePer: 0.02, edge: 0.08, edgeBase: 0.08, pSide: 0.7, ...over });
const cur = TIMING_POLICIES.current;

describe("approval: calibrated probability + conservative EV after fees and cushion", () => {
  it("defaults: enforced, live lock still on, current timing, 3¢ cushion", () => {
    expect(APPROVAL_POLICY_ENFORCED).toBe(true);
    expect(CALIBRATED_MODEL_APPROVED).toBe(false);
    expect(TIMING_POLICY).toBe("current");
    expect(APPROVAL_CUSHION).toBe(0.03);
  });
  it("no calibrated probability → never approved, whatever the raw edge or confluence", () => {
    const a = approve({ pYesRaw: 0.99, calibrator: null, candidate: cand({ price: 0.1 }), tteSec: 400, policy: cur, cushion: 0.03 });
    expect(a).toMatchObject({ ok: false, why: "no_calibrated_probability" });
  });
  it("EV = P_cal(side) − cushion − price − fee/contract − bucket extra; must be > 0", () => {
    const ok = approve({ pYesRaw: 0.7, calibrator: cal(), candidate: cand(), tteSec: 400, policy: cur, cushion: 0.03 });
    expect(ok.ok).toBe(true);
    expect(ok.evPerContract).toBeCloseTo(0.7 - 0.03 - 0.6 - 0.02, 4);
    expect(approve({ pYesRaw: 0.7, calibrator: cal(), candidate: cand(), tteSec: 400, policy: cur, cushion: 0.09 })).toMatchObject({ ok: false, why: "conservative_ev_not_positive" });
    const no = approve({ pYesRaw: 0.2, calibrator: cal(), candidate: cand({ side: "no", price: 0.7 }), tteSec: 400, policy: cur, cushion: 0.03 });
    expect(no.evPerContract).toBeCloseTo(0.8 - 0.03 - 0.7 - 0.02, 4);
  });
  it("the calibrator really moves P (an over-confident model is shrunk)", () => {
    const shrink = cal({ a: 0.5 });
    expect(calibrate(shrink, 0.9)).toBeCloseTo(0.75, 2);
    expect(approve({ pYesRaw: 0.9, calibrator: shrink, candidate: cand({ price: 0.8 }), tteSec: 400, policy: cur, cushion: 0.03 }).ok).toBe(false);
  });
  it("calibrator file: must be for this model, operator-approved, Platt, and have beaten the market out of sample", () => {
    const dir = mkdtempSync(join(tmpdir(), "cal-"));
    const f = join(dir, "c.json");
    const put = (c: unknown) => writeFileSync(f, JSON.stringify(c));
    expect(loadCalibrator(f, MODEL)).toBeNull();
    put(cal());
    expect(loadCalibrator(f, MODEL)?.id).toBe("c1");
    expect(loadCalibrator(f, "other")).toBeNull();
    put(cal({ approvedBy: null }));
    expect(loadCalibrator(f, MODEL)).toBeNull();
    put(cal({ outOfSample: { contracts: 600, windows: 120, brierModel: 0.12, brierMarket: 0.11 } }));
    expect(loadCalibrator(f, MODEL)).toBeNull();
    put(cal({ a: -1 }));
    expect(loadCalibrator(f, MODEL)).toBeNull();
    writeFileSync(f, "{torn");
    expect(loadCalibrator(f, MODEL)).toBeNull();
  });
});

describe("timing policy by time-to-expiry bucket (configurable, not hard-coded)", () => {
  it("current policy reproduces the old timing: every bucket from 3 s up allows maker and taker, no extra edge", () => {
    for (const t of [3, 30, 59, 61, 200, 400, 899]) {
      const b = bucketFor(cur, t)!;
      expect([b.allow, b.allowMaker, b.allowTaker, b.extraEdge, b.minPrice]).toEqual([true, true, true, 0, 0]);
    }
    expect(bucketFor(cur, 2)!.allow).toBe(false);
    expect(bucketFor(cur, -1)).toBeNull();
  });
  it("final-10-minute PROPOSAL: no entries >10 min, extra edge as the window shortens, taker-only ≥5¢ in the last minute", () => {
    const p = TIMING_POLICIES.final10_proposal;
    expect(p.status).toBe("proposal");
    const c = cal();
    expect(approve({ pYesRaw: 0.9, calibrator: c, candidate: cand(), tteSec: 700, policy: p, cushion: 0.03 }).why).toBe("timing_>10m");
    expect(approve({ pYesRaw: 0.7, calibrator: c, candidate: cand(), tteSec: 400, policy: p, cushion: 0.03 }).ok).toBe(true);
    expect(approve({ pYesRaw: 0.7, calibrator: c, candidate: cand(), tteSec: 120, policy: p, cushion: 0.03 }).evPerContract).toBeCloseTo(0.04, 4);
    expect(approve({ pYesRaw: 0.9, calibrator: c, candidate: cand({ mode: "maker" }), tteSec: 30, policy: p, cushion: 0.03 }).why).toBe("timing_no_maker_final-60s");
    expect(approve({ pYesRaw: 0.2, calibrator: c, candidate: cand({ price: 0.04 }), tteSec: 30, policy: p, cushion: 0.03 }).why).toBe("timing_min_price_final-60s");
  });
  it("the evaluator applies the policy and the approval before the release lock (source order)", () => {
    const src = readFileSync(new URL("./evaluator.ts", import.meta.url), "utf8") as string;
    const i = (s: string) => src.indexOf(s);
    expect(i("bucketFor(policy, left)")).toBeGreaterThan(0);
    expect(i("out.approval = approve(")).toBeGreaterThan(i("scoreSides("));
    expect(i("G3_approval_")).toBeLessThan(i("G3_uncalibrated_model_shadow_only"));
  });
});
