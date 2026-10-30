/**
 * Killzone tags (AEIOU #20, MMM #111–113). New York clock, daylight saving handled by Intl.
 * London 02:00–05:00, New York AM 07:00–10:00, New York PM 13:30–16:00, Asia 19:00–24:00.
 * These are tags the model weighs from data. They are not a rule that blocks trades by themselves.
 */
export type Session = "london" | "ny_am" | "ny_pm" | "asia" | "off";

const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "numeric", hour12: false, weekday: "short" });

export function nyClock(ms: number): { mins: number; weekday: string } {
  const parts = fmt.formatToParts(ms);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return { mins: (Number(get("hour")) % 24) * 60 + Number(get("minute")), weekday: get("weekday") };
}

export function sessionOf(ms: number): Session {
  const { mins } = nyClock(ms);
  if (mins >= 120 && mins < 300) return "london";
  if (mins >= 420 && mins < 600) return "ny_am";
  if (mins >= 810 && mins < 960) return "ny_pm";
  if (mins >= 1140) return "asia";
  return "off";
}

export function inKillzone(ms: number): boolean {
  const s = sessionOf(ms);
  return s === "london" || s === "ny_am" || s === "ny_pm";
}
