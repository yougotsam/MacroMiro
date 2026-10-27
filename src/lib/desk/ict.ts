/**
 * One ICT-style sequence, written as checks a machine can fail.
 * A killzone, a sweep that closes back, and a fair-value gap in that direction.
 * This is a hypothesis. It does not send, and it has not been scored on Kalshi.
 */

export type Bar = { h: number; l: number; c: number };

/** London open, New York morning, New York afternoon. New York clock. No trade outside these. */
export function inKillzone(nowMs: number): boolean {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false }).format(nowMs)) % 24;
  const minute = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", minute: "numeric" }).format(nowMs));
  const mins = hour * 60 + minute;
  const inLondon = mins >= 2 * 60 && mins < 5 * 60;
  const inNyAm = mins >= 8 * 60 + 30 && mins < 11 * 60;
  const inNyPm = mins >= 14 * 60 && mins < 15 * 60;
  return inLondon || inNyAm || inNyPm;
}

/** Bull gap: the bar two back's high is below the latest low. Bear gap is the mirror. */
export function fairGap(bars: Bar[]): "yes" | "no" | null {
  if (bars.length < 3) return null;
  const a = bars[bars.length - 3];
  const c = bars[bars.length - 1];
  if (a.h < c.l) return "yes";
  if (a.l > c.h) return "no";
  return null;
}

/**
 * Sweep the prior swing, close back through it, and leave a gap in that direction.
 * The last three bars are the sweep. The swing is the extreme before them.
 */
export function sweepGap(bars: Bar[]): { side: "yes" | "no"; why: string } | null {
  if (bars.length < 8) return null;
  const prior = bars.slice(0, -3);
  const swingHigh = Math.max(...prior.map((b) => b.h));
  const swingLow = Math.min(...prior.map((b) => b.l));
  const leg = bars.slice(-3);
  const sweptLow = leg.some((b) => b.l < swingLow) && leg[leg.length - 1].c > swingLow;
  const sweptHigh = leg.some((b) => b.h > swingHigh) && leg[leg.length - 1].c < swingHigh;
  const gap = fairGap(bars);
  if (sweptLow && !sweptHigh && gap === "yes") return { side: "yes", why: "swept the low, closed back, bull gap" };
  if (sweptHigh && !sweptLow && gap === "no") return { side: "no", why: "swept the high, closed back, bear gap" };
  return null;
}
