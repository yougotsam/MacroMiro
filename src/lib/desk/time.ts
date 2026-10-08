/** ET calendar day (the risk day resets at 00:00 America/New_York). */
export function etDay(ms = Date.now()) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}
/** epoch ms of 00:00 ET for the day containing ms */
export function etDayStart(ms = Date.now()) {
  const day = etDay(ms);
  // find the UTC instant whose ET date first equals `day` (search the 24h before ms in 1-minute steps, then exact)
  let lo = ms - 26 * 3600_000;
  let hi = ms;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (etDay(mid) === day) hi = mid;
    else lo = mid;
  }
  return hi;
}
