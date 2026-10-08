/**
 * Execution guard (adverse selection). Pure functions + a small per-series state machine.
 *  - fast move: log return over the last 2–5 s of settlement-index prints vs K·σ·√L, σ = the model's σ
 *  - shock: how far P moves on a 1σ index move over SHOCK_LATENCY_SEC → extra edge a resting bid must carry
 *  - final seconds: resting bids are pulled in the last FINAL_PULL_SEC unless the 60 s average is mostly locked
 *  - last minute: never buy under 5¢
 */
import {
  FAST_COOLDOWN_MS,
  FAST_K,
  FAST_LOOKBACKS_SEC,
  FAST_SETTLE_Z,
  FINAL_PULL_SEC,
  HOLD_SHOCK_FRAC,
  LAST_MINUTE_MIN_PRICE,
  LAST_MINUTE_SEC,
  LOCK_MIN_FRAC,
  SHOCK_LATENCY_SEC,
} from "./config";
import { restingEdge, type Side } from "./gate";
import type { Print } from "./settlement";

export type MoveDir = "up" | "down";

/** z of the index move over the last `lookbackSec` (null when the prints can't say). */
export function moveZ(prints: Print[], sigma: number, lookbackSec: number): number | null {
  const last = prints[prints.length - 1];
  if (!last || !(sigma > 0)) return null;
  const target = last.t - lookbackSec * 1000;
  let ref: Print | null = null;
  for (let i = prints.length - 2; i >= 0; i -= 1) {
    if (prints[i].t <= target) {
      ref = prints[i];
      break;
    }
  }
  if (!ref || target - ref.t > 2_000) return null;
  const dt = (last.t - ref.t) / 1000;
  if (!(dt > 0)) return null;
  return Math.log(last.v / ref.v) / (sigma * Math.sqrt(dt));
}

/** Largest |z| over the lookbacks; a direction only when it exceeds k. */
export function fastMove(prints: Print[], sigma: number, k = FAST_K): { dir: MoveDir | null; z: number } {
  let best = 0;
  for (const L of FAST_LOOKBACKS_SEC) {
    const z = moveZ(prints, sigma, L);
    if (z != null && Math.abs(z) > Math.abs(best)) best = z;
  }
  return { dir: Math.abs(best) > k ? (best > 0 ? "up" : "down") : null, z: best };
}

/** A down move hurts resting YES bids; an up move hurts resting NO bids. */
export function against(dir: MoveDir, side: Side) {
  return (dir === "down" && side === "yes") || (dir === "up" && side === "no");
}

export type GuardState = { cooling: boolean; dir: MoveDir | null; z: number; triggered: boolean; until: number };

export class MoveGuard {
  private s = new Map<string, { until: number; dir: MoveDir }>();

  observe(series: string, prints: Print[], sigma: number | null, now: number): GuardState {
    const cur = this.s.get(series);
    if (sigma == null || !prints.length) return this.state(series, now, 0, false);
    const f = fastMove(prints, sigma);
    if (f.dir) {
      this.s.set(series, { until: now + FAST_COOLDOWN_MS, dir: f.dir });
      return { cooling: true, dir: f.dir, z: f.z, triggered: !cur || cur.until <= now || cur.dir !== f.dir, until: now + FAST_COOLDOWN_MS };
    }
    if (cur && now >= cur.until) {
      const z5 = moveZ(prints, sigma, 5);
      if (z5 != null && Math.abs(z5) < FAST_SETTLE_Z) this.s.delete(series);
      else cur.until = now + 1_000; // not settled yet: keep cooling
    }
    return this.state(series, now, f.z, false);
  }

  state(series: string, now: number, z = 0, triggered = false): GuardState {
    const cur = this.s.get(series);
    const cooling = Boolean(cur && cur.until > now);
    return { cooling, dir: cooling ? cur!.dir : null, z, triggered, until: cur?.until ?? 0 };
  }
}

/** Extra edge a resting bid needs: |ΔP| for a 1σ index move over the cancel latency (same σ as the model). */
export function shockOf(pAt: (v: number) => number, v: number, sigma: number, latencySec = SHOCK_LATENCY_SEC) {
  const d = sigma * Math.sqrt(latencySec);
  const p0 = pAt(v);
  return Math.max(Math.abs(pAt(v * (1 + d)) - p0), Math.abs(pAt(v * (1 - d)) - p0));
}

/** Resting (maker) bids are allowed unless we're in the final seconds with the average not mostly locked. */
export function makerWindowOk(tteSec: number, lockFrac: number, kind: "rti60" | "pyth1m") {
  if (tteSec > FINAL_PULL_SEC) return true;
  return kind === "rti60" && lockFrac >= LOCK_MIN_FRAC;
}

/** Lowest price we may buy at, given time to close. */
export function minPriceFor(tteSec: number) {
  return tteSec <= LAST_MINUTE_SEC ? LAST_MINUTE_MIN_PRICE : 0;
}

/** Why a resting desk bid must be pulled now (null = keep). */
export function pullReason(x: {
  side: Side;
  price: number;
  p: number | null;
  failed: string | null;
  shock: number;
  tte: number | null;
  lockFrac: number;
  kind: "rti60" | "pyth1m";
  guard: GuardState;
}): string | null {
  if (x.guard.dir && against(x.guard.dir, x.side)) return `fast move ${x.guard.dir} z=${x.guard.z.toFixed(1)}`;
  if (x.tte != null && !makerWindowOk(x.tte, x.lockFrac, x.kind)) return `final ${Math.round(x.tte)}s, average ${Math.round(x.lockFrac * 100)}% locked`;
  if (x.tte != null && x.price < minPriceFor(x.tte)) return "under 5¢ in the last minute";
  if (x.p == null) return `data gate ${x.failed}`;
  const edge = restingEdge(x.p, x.side, x.price);
  const hold = HOLD_SHOCK_FRAC * x.shock;
  if (edge < hold) return `edge ${edge.toFixed(3)} < hold ${hold.toFixed(3)}`;
  return null;
}
