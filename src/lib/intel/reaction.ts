export type PxBar = { t: number; c: number };

export function pctAfter(bars: PxBar[], eventMs: number, horizonMs: number): number | null {
  const sorted = [...bars].filter((b) => Number.isFinite(b.c) && b.c > 0).sort((a, b) => a.t - b.t);
  let base: PxBar | null = null;
  for (const bar of sorted) {
    if (bar.t <= eventMs) base = bar;
    else break;
  }
  if (!base) return null;
  const target = eventMs + horizonMs;
  const later = sorted.find((b) => b.t >= target);
  if (!later || later.t - target > horizonMs) return null;
  return ((later.c - base.c) / base.c) * 100;
}

export function sayMove(asset: string, pct: number | null, label: string) {
  if (pct == null) return `${asset} ${label} was not in the price feed`;
  const sign = pct >= 0 ? "+" : "";
  return `${asset} ${sign}${pct.toFixed(2)}% over the next ${label}`;
}
