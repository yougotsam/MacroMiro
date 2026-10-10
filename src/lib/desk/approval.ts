/**
 * Trade approval (round 3). A candidate from the execution gate is approved only when
 *   1. a calibrated settlement probability exists: an operator-approved calibrator (Platt a·logit(p)+b) fitted out of
 *      sample for THIS model version — no calibrator, no approval;
 *   2. conservative EV per contract at the executable price is positive:
 *        EV = P_cal(side) − cushion − price − fee/contract − bucket.extraEdge  > 0
 *      (taker price = the ask actually displayed, size ≤ displayed depth — scoreSides already caps it);
 *   3. the time-to-expiry policy allows the bucket.
 * The 13-point confluence score is carried for ranking/research only and can never approve by itself.
 * Research/news inputs are not parameters here (research-context.test.ts enforces that).
 */
import { existsSync, readFileSync } from "node:fs";
import { LAST_MINUTE_MIN_PRICE, MIN_SECONDS_LEFT } from "./config";
import type { Candidate } from "./gate";

export type TteBucket = { name: string; minSec: number; maxSec: number; allow: boolean; allowMaker: boolean; allowTaker: boolean; extraEdge: number; minPrice: number };
export type TimingPolicy = { id: string; status: "active_default" | "proposal"; buckets: TteBucket[] };

const B = (name: string, minSec: number, maxSec: number, o: Partial<TteBucket> = {}): TteBucket => ({ name, minSec, maxSec, allow: true, allowMaker: true, allowTaker: true, extraEdge: 0, minPrice: 0, ...o });

export const TIMING_POLICIES: Record<"current" | "final10_proposal", TimingPolicy> = {
  /** Reproduces the pre-round-3 behaviour exactly (maker final-seconds pull and the 5¢ last-minute floor live in guard.ts). */
  current: {
    id: "current-v1",
    status: "active_default",
    buckets: [B(">10m", 600, Infinity), B("5-10m", 300, 600), B("1-5m", 60, 300), B("final-60s", MIN_SECONDS_LEFT, 60), B("<3s", 0, MIN_SECONDS_LEFT, { allow: false })],
  },
  /**
   * PROPOSAL (not active): enter only in the final 10 minutes, demand more edge as the window shortens, taker-only with
   * a 5¢ floor in the final minute. Numbers are placeholders for the owner; activate via TIMING_POLICY after a shadow run.
   */
  final10_proposal: {
    id: "final10-proposal-v1",
    status: "proposal",
    buckets: [
      B(">10m", 600, Infinity, { allow: false }),
      B("5-10m", 300, 600),
      B("1-5m", 60, 300, { extraEdge: 0.01 }),
      B("final-60s", MIN_SECONDS_LEFT, 60, { allowMaker: false, extraEdge: 0.02, minPrice: LAST_MINUTE_MIN_PRICE }),
      B("<3s", 0, MIN_SECONDS_LEFT, { allow: false }),
    ],
  },
};

export function bucketFor(policy: TimingPolicy, tteSec: number): TteBucket | null {
  if (!Number.isFinite(tteSec) || tteSec < 0) return null;
  return policy.buckets.find((b) => tteSec >= b.minSec && tteSec < b.maxSec) ?? null;
}

/** Reporting buckets (same edges as the policies) for analysis. */
export function reportBucket(tteSec: number): string {
  return bucketFor(TIMING_POLICIES.current, tteSec)?.name ?? "closed";
}

export type Calibrator = {
  id: string;
  model: string;
  method: "platt";
  a: number;
  b: number;
  fittedOn: { contracts: number; windows: number; from: string; to: string };
  outOfSample: { contracts: number; windows: number; brierModel: number; brierMarket: number };
  approvedBy: string | null;
  approvedAt: string | null;
};

/** An approved calibrator for this exact model version, or null (→ no approval possible). */
export function loadCalibrator(path: string, model: string): Calibrator | null {
  try {
    if (!existsSync(path)) return null;
    const c = JSON.parse(readFileSync(path, "utf8")) as Calibrator;
    if (c.method !== "platt" || c.model !== model || !Number.isFinite(c.a) || !Number.isFinite(c.b) || !(c.a > 0)) return null;
    if (!c.approvedBy || !c.approvedAt || !Number.isFinite(Date.parse(c.approvedAt))) return null;
    // a calibrator must have beaten the market out of sample to be usable at all
    if (!(c.outOfSample?.brierModel < c.outOfSample?.brierMarket)) return null;
    return c;
  } catch {
    return null;
  }
}

export function calibrate(c: Calibrator, p: number) {
  const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
  const z = c.a * Math.log(q / (1 - q)) + c.b;
  return 1 / (1 + Math.exp(-z));
}

export type Approval = { ok: boolean; why: string; pCal: number | null; evPerContract: number | null; bucket: string | null; cushion: number };

export function approve(x: { pYesRaw: number | null; calibrator: Calibrator | null; candidate: Candidate | null; tteSec: number; policy: TimingPolicy; cushion: number }): Approval {
  const bucket = bucketFor(x.policy, x.tteSec);
  const base = { pCal: null, evPerContract: null, bucket: bucket?.name ?? null, cushion: x.cushion };
  if (!bucket || !bucket.allow) return { ...base, ok: false, why: `timing_${bucket?.name ?? "none"}` };
  if (!x.candidate) return { ...base, ok: false, why: "no_candidate" };
  if (x.candidate.mode === "maker" && !bucket.allowMaker) return { ...base, ok: false, why: `timing_no_maker_${bucket.name}` };
  if (x.candidate.mode === "taker" && !bucket.allowTaker) return { ...base, ok: false, why: `timing_no_taker_${bucket.name}` };
  if (x.candidate.price < bucket.minPrice) return { ...base, ok: false, why: `timing_min_price_${bucket.name}` };
  if (x.pYesRaw == null || !Number.isFinite(x.pYesRaw) || !x.calibrator) return { ...base, ok: false, why: "no_calibrated_probability" };
  if (!(x.cushion >= 0)) return { ...base, ok: false, why: "cushion_invalid" };
  const pCal = calibrate(x.calibrator, x.pYesRaw);
  const pSide = x.candidate.side === "yes" ? pCal : 1 - pCal;
  const ev = pSide - x.cushion - x.candidate.price - x.candidate.feePer - bucket.extraEdge;
  const out = { ...base, pCal, evPerContract: Number(ev.toFixed(4)) };
  if (!(ev > 0)) return { ...out, ok: false, why: "conservative_ev_not_positive" };
  return { ...out, ok: true, why: "approved" };
}
