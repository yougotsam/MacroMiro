/**
 * Smart-money structure as checks a machine can fail (AEIOU #14–26, MMM #101–105, #117).
 * Pure, closed bars only. Each function answers at bar i using bars[0..i].
 * Definitions (stated, because teachers differ):
 *  - swing high/low: a fractal with `wing` lower highs / higher lows on each side (confirmed `wing` bars later).
 *  - BOS: close beyond the last confirmed swing in the direction of the prior break. ChoCH: the first break against it.
 *  - liquidity sweep: a recent bar trades through the prior `look`-bar extreme and the latest bar closes back inside.
 *  - FVG: bar[k-2].h < bar[k].l (bull) or bar[k-2].l > bar[k].h (bear), still unfilled at i.
 *  - order block: the last opposite candle before the impulse that made a BOS; "retest" = price back inside it.
 *  - premium/discount: where the close sits in the last `look`-bar range, −1 (bottom) .. +1 (top).
 */
import type { Bar } from "./ta";

export type Dir = -1 | 0 | 1;

export type Structure = {
  /** +1 bullish break of structure in the last `recent` bars, −1 bearish, 0 none */
  bos: Dir;
  /** +1 if that break flipped a bearish leg (change of character), −1 the mirror, 0 otherwise */
  choch: Dir;
  /** the direction of the last confirmed break, used as trend */
  trend: Dir;
  /** level of the most recent bull/bear order block, if one is still being retested */
  obRetest: Dir;
};

function isSwingHigh(b: Bar[], k: number, wing: number) {
  for (let j = 1; j <= wing; j++) if (!(b[k].h > b[k - j].h && b[k].h >= b[k + j].h)) return false;
  return true;
}
function isSwingLow(b: Bar[], k: number, wing: number) {
  for (let j = 1; j <= wing; j++) if (!(b[k].l < b[k - j].l && b[k].l <= b[k + j].l)) return false;
  return true;
}

/** Structure at bar i. Scans the last `span` bars; a swing at k is only known at k + wing ≤ i. */
export function structureAt(b: Bar[], i: number, span = 96, wing = 2, recent = 4): Structure {
  const out: Structure = { bos: 0, choch: 0, trend: 0, obRetest: 0 };
  const start = Math.max(wing, i - span);
  let lastHigh: number | null = null;
  let lastLow: number | null = null;
  let trend: Dir = 0;
  let lastBreakAt = -1;
  let lastBreakDir: Dir = 0;
  let lastFlip = false;
  let ob: { dir: Dir; hi: number; lo: number } | null = null;
  for (let j = start; j <= i; j++) {
    const k = j - wing; // swing candidate now confirmed
    if (k >= start) {
      if (isSwingHigh(b, k, wing)) lastHigh = b[k].h;
      if (isSwingLow(b, k, wing)) lastLow = b[k].l;
    }
    let dir: Dir = 0;
    if (lastHigh != null && b[j].c > lastHigh && (j === 0 || b[j - 1].c <= lastHigh)) dir = 1;
    else if (lastLow != null && b[j].c < lastLow && (j === 0 || b[j - 1].c >= lastLow)) dir = -1;
    if (dir !== 0) {
      lastFlip = trend !== 0 && dir !== trend;
      trend = dir;
      lastBreakAt = j;
      lastBreakDir = dir;
      // order block: last opposite-colored candle in the 8 bars before the break
      for (let m = j - 1; m >= Math.max(start, j - 8); m--) {
        const bear = b[m].c < b[m].o;
        const bull = b[m].c > b[m].o;
        if ((dir === 1 && bear) || (dir === -1 && bull)) {
          ob = { dir, hi: b[m].h, lo: b[m].l };
          break;
        }
      }
      if (dir === 1) lastHigh = null;
      else lastLow = null;
    }
    // an order block is spent once price closes through its far side
    if (ob && ((ob.dir === 1 && b[j].c < ob.lo) || (ob.dir === -1 && b[j].c > ob.hi))) ob = null;
  }
  out.trend = trend;
  if (lastBreakAt >= 0 && i - lastBreakAt < recent) {
    out.bos = lastBreakDir;
    out.choch = lastFlip ? lastBreakDir : 0;
  }
  if (ob && b[i].l <= ob.hi && b[i].h >= ob.lo) out.obRetest = ob.dir;
  return out;
}

/** +1: swept the prior low and closed back above it; −1: swept the prior high and closed back below. */
export function liquiditySweepAt(b: Bar[], i: number, look = 20, leg = 3): Dir {
  if (i < look + leg) return 0;
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = i - look - leg + 1; j <= i - leg; j++) {
    hi = Math.max(hi, b[j].h);
    lo = Math.min(lo, b[j].l);
  }
  let sweptLow = false;
  let sweptHigh = false;
  for (let j = i - leg + 1; j <= i; j++) {
    if (b[j].l < lo) sweptLow = true;
    if (b[j].h > hi) sweptHigh = true;
  }
  const c = b[i].c;
  const bull = sweptLow && c > lo;
  const bear = sweptHigh && c < hi;
  if (bull && !bear) return 1;
  if (bear && !bull) return -1;
  return 0;
}

/** Newest unfilled fair-value gap formed in the last `look` bars: +1 bull, −1 bear, 0 none. */
export function openFvgAt(b: Bar[], i: number, look = 6): Dir {
  for (let k = i; k >= Math.max(2, i - look + 1); k--) {
    const a = b[k - 2];
    const c = b[k];
    if (a.h < c.l) {
      let filled = false;
      for (let j = k + 1; j <= i; j++) if (b[j].l <= a.h) filled = true;
      if (!filled) return 1;
    } else if (a.l > c.h) {
      let filled = false;
      for (let j = k + 1; j <= i; j++) if (b[j].h >= a.l) filled = true;
      if (!filled) return -1;
    }
  }
  return 0;
}

/** −1 at the bottom of the last `look` bars, +1 at the top. */
export function premiumDiscountAt(b: Bar[], i: number, look = 96): number {
  if (i < 1) return 0;
  let hi = -Infinity;
  let lo = Infinity;
  for (let j = Math.max(0, i - look + 1); j <= i; j++) {
    hi = Math.max(hi, b[j].h);
    lo = Math.min(lo, b[j].l);
  }
  if (!(hi > lo)) return 0;
  return ((b[i].c - lo) / (hi - lo)) * 2 - 1;
}
