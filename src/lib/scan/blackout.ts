/** High-impact minutes only. Eastern time. 10 minutes before, 15 minutes after. Not a direction. */

type Release = { y: number; m: number; d: number; minutes: number; name: string };

const RELEASES: Release[] = [
  { y: 2026, m: 10, d: 7, minutes: 14 * 60, name: "FOMC minutes" },
  { y: 2026, m: 10, d: 14, minutes: 8 * 60 + 30, name: "CPI" },
  { y: 2026, m: 10, d: 28, minutes: 14 * 60, name: "FOMC decision" },
  { y: 2026, m: 11, d: 6, minutes: 8 * 60 + 30, name: "NFP" },
];

function etClock(ms: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { y: n("year"), m: n("month"), d: n("day"), minutes: n("hour") * 60 + n("minute") };
}

/** True only in the shock window. A filled ticket is not closed by this. */
export function inEventBlackout(nowMs: number): boolean {
  const now = etClock(nowMs);
  return RELEASES.some((r) => r.y === now.y && r.m === now.m && r.d === now.d && now.minutes >= r.minutes - 10 && now.minutes <= r.minutes + 15);
}

export function blackoutName(nowMs: number): string | null {
  const now = etClock(nowMs);
  const hit = RELEASES.find((r) => r.y === now.y && r.m === now.m && r.d === now.d && now.minutes >= r.minutes - 10 && now.minutes <= r.minutes + 15);
  return hit ? hit.name : null;
}

/** Five minutes before a release. This is the radar ping, not a direction. */
export function volAlert(nowMs: number): string | null {
  const now = etClock(nowMs);
  const hit = RELEASES.find((r) => r.y === now.y && r.m === now.m && r.d === now.d && now.minutes >= r.minutes - 5 && now.minutes < r.minutes);
  if (!hit) return null;
  return `${hit.name} in ${hit.minutes - now.minutes}m`;
}
