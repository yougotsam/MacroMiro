import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCalibrator } from "./approval";
import type { Obs } from "./calibration";
import { evaluateSetups, indexIndicators, setupsOf } from "./setups";
import { candidateCalibrator, milestone, scoreSources, sourcePnl, timingBuckets, walkForward } from "./walkforward";

const T0 = Date.UTC(2026, 9, 9, 0, 0);
function rand(seed: number) { let s = seed; return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31); }
/** synthetic world where z carries the truth, the mid is noisy and the model is over-confident */
function world(windows = 60, seed = 3): Obs[] {
  const r = rand(seed);
  const out: Obs[] = [];
  for (let w = 0; w < windows; w += 1) for (const s of ["KXBTC15M", "KXETH15M"]) for (const tte of [600, 300, 120, 45]) {
    const z = (r() - 0.5) * 4;
    const pt = 1 / (1 + Math.exp(-z));
    const y = (r() < pt ? 1 : 0) as 0 | 1;
    const mid = Math.min(0.97, Math.max(0.03, pt + (r() - 0.5) * 0.3));
    const p = Math.min(0.99, Math.max(0.01, 1 / (1 + Math.exp(-2 * z))));
    out.push({ ticker: `${s}-W${w}-00`, series: s, model: "m", closeMs: T0 + w * 900_000, tteBucket: tte, tte, p, pBase: p, yesBid: Math.round((mid - 0.01) * 100) / 100, yesAsk: Math.round((mid + 0.01) * 100) / 100, mid, y, yesBidSize: 20, noBidSize: 20, feeMultiplier: 1, z, dist: z / 1000 });
  }
  return out;
}

describe("walk-forward validation", () => {
  it("is chronological and leakage-free: every fold trains only on windows closed before the purge gap", () => {
    const obs = world();
    const wf = walkForward(obs, { minTrainWindows: 20, stepWindows: 5, purgeMs: 30 * 60_000 });
    expect(wf.folds.length > 0).toBe(true);
    for (const f of wf.folds) expect(f.trainWindows <= (Date.parse(f.testFrom) - T0 - 30 * 60_000) / 900_000 + 1).toBe(true);
    // the first 20 windows are never scored
    expect(wf.preds.every((x) => x.o.closeMs >= T0 + 20 * 900_000)).toBe(true);
  });
  it("changing a FUTURE outcome cannot change an earlier prediction (no look-ahead)", () => {
    const a = world();
    const b = a.map((o) => (o.closeMs === T0 + 59 * 900_000 ? { ...o, y: (1 - o.y) as 0 | 1 } : o));
    const pa = walkForward(a).preds.filter((x) => x.o.closeMs < T0 + 55 * 900_000);
    const pb = walkForward(b).preds.filter((x) => x.o.closeMs < T0 + 55 * 900_000);
    expect(pa.map((x) => x.p.model_wf_platt)).toEqual(pb.map((x) => x.p.model_wf_platt));
  });
  it("scores all sources on the same rows and recovers the informative baseline", () => {
    const wf = walkForward(world(80));
    const s = scoreSources(wf.preds) as Record<string, { brier: number } | number>;
    const b = (k: string) => (s[k] as { brier: number }).brier;
    expect(b("threshold_vol") < b("coin")).toBe(true);
    expect(b("model_wf_platt") <= b("model_raw")).toBe(true); // recalibration fixes over-confidence
    const pnl = sourcePnl(wf.preds) as Record<string, { yes: unknown; no: unknown } | string>;
    expect(typeof pnl.market_mid).toBe("string");
    expect(pnl.model_raw).toHaveProperty("yes");
    expect(pnl.model_raw).toHaveProperty("no");
    expect(Object.keys(timingBuckets(wf.preds))).toEqual([">10m", "5-10m", "1-5m", "final-60s"]);
  });
  it("milestone: 200 windows with ZERO approved trades is reachable; approval is never an input", () => {
    expect(milestone(57)).toMatchObject({ state: "collecting", need: 143, approvedTradesRequired: 0 });
    expect(milestone(200)).toMatchObject({ state: "evaluate", approvedTradesRequired: 0 });
    expect(milestone(250, { skillCi95: [-0.01, 0.05], pnlCi95: [0.01, 0.1] }).state).toBe("not_ready_failed_walk_forward");
    expect(milestone(250, { skillCi95: [0.01, 0.05], pnlCi95: [0.01, 0.1] }).state).toBe("candidate_for_owner_review");
  });
  it("a candidate calibrator is never usable until a person signs it (never force-approved)", () => {
    const c = candidateCalibrator(world(30), "m", { contracts: 10, windows: 5, brierModel: 0.1, brierMarket: 0.2 });
    expect(c.approvedBy).toBeNull();
    const dir = mkdtempSync(join(tmpdir(), "cand-"));
    writeFileSync(join(dir, "cal.json"), JSON.stringify(c));
    expect(loadCalibrator(join(dir, "cal.json"), "m")).toBeNull();
  });
});

describe("named shadow setups", () => {
  const ind = (ts: string, series: string, extra: Record<string, unknown> = {}) => ({ ts, series, report: { bos_mss: { available: true, value: { trend: "up", bos: "long", mss: null } }, fvg: { available: false, value: { direction: "short" } } }, sniper: { long: { setup: "TREND_PULLBACK", score: 8, eligible: false }, short: { setup: "NONE", score: 2, eligible: false } }, ...extra });
  it("fires only from available modules (an unavailable module is never filled in)", () => {
    const names = setupsOf(ind("2026-10-09T00:00:00Z", "KXBTC15M")).map((h) => `${h.name}:${h.dir}`);
    expect(names).toEqual(["TREND_PULLBACK:long", "CONFLUENCE_7PLUS:long", "BOS_CONFIRMED:long"]);
  });
  it("uses only snapshots taken before the observation (no look-ahead) and measures vs the settlement model", () => {
    const obs = world(40).filter((o) => o.series === "KXBTC15M" && o.tte === 300);
    const rows = obs.map((o) => ind(new Date(o.closeMs - 300_000 - 30_000).toISOString(), "KXBTC15M"));
    const future = obs.map((o) => ind(new Date(o.closeMs - 300_000 + 30_000).toISOString(), "KXETH15M"));
    const r = evaluateSetups(obs, indexIndicators([...rows, ...future])) as Record<string, { contracts: number }>;
    expect(r.TREND_PULLBACK.contracts).toBe(40);
    expect(r.FVG_OPEN.contracts).toBe(0);
    const late = evaluateSetups(obs, indexIndicators(obs.map((o) => ind(new Date(o.closeMs - 300_000 + 1000).toISOString(), "KXBTC15M")))) as Record<string, { contracts: number }>;
    expect(late.TREND_PULLBACK.contracts).toBe(0);
  });
});
