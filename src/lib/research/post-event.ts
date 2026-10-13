/**
 * Post-event evaluation (round 3.3): pre-event MiroFish scenarios vs the actual market reaction, and vs a
 * news + price-only baseline. Pure; no network. Runs for real only after the release (the actual print is needed).
 *
 * Realized class from the official surprise (actual CPI m/m − the pre-event Cleveland Fed nowcast, both official,
 * the nowcast taken from the archived pre-event seed):
 *   |surprise| < IN_LINE_PP → baseline; surprise > 0 (hot) → bearish for risk; surprise < 0 (cool) → bullish.
 *   "unexpected" = the realized move is beyond MOVE_Z σ and AGAINST the surprise-implied direction.
 * MiroFish call = the lean of the archived run whose scenario equals the realized class.
 * Baseline call ("news + price only") = surprise-implied direction; when in line, the pre-event 60-min momentum sign.
 * n = 5 assets × 3 horizons from ONE event, strongly correlated: anecdotal, no significance claimed.
 */
export const IN_LINE_PP = 0.1;
export const MOVE_Z = 1;
export const HORIZONS = [15, 60, 240] as const;
export type Dir = "up" | "down" | "flat";
export type Point = { ms: number; value: number };

/** "increased 0.4 percent on a seasonally adjusted basis in September" / "was unchanged" / "declined 0.1 percent" */
export function parseCpiMoM(releaseText: string, refMonth: string): number | null {
  const t = releaseText.replace(/\s+/g, " ");
  const m = t.match(new RegExp(`\\(CPI-U\\) (increased|rose|declined|decreased|fell|was unchanged)(?: (\\d+(?:\\.\\d+)?) percent)? on a seasonally adjusted basis in ${refMonth}`, "i"));
  if (!m) return null;
  if (/unchanged/i.test(m[1])) return 0;
  const v = Number(m[2]);
  return /declined|decreased|fell/i.test(m[1]) ? -v : v;
}
/** the archived nowcast table: "Month CPI Core CPI PCE Core PCE Updated September 2026 0.53 0.20 ..." → 0.53 */
export function parseNowcastMoM(seedText: string, refMonthYear: string): number | null {
  const t = seedText.replace(/\s+/g, " ");
  const i = t.indexOf("Inflation, month-over-month percent change");
  if (i < 0) return null;
  const m = t.slice(i, i + 600).match(new RegExp(`${refMonthYear} (-?\\d+\\.\\d+)`));
  return m ? Number(m[1]) : null;
}

export function at(xs: Point[], ms: number, tolMs = 90_000): number | null {
  let best: Point | null = null;
  for (const p of xs) if (p.ms <= ms && ms - p.ms <= tolMs && (!best || p.ms > best.ms)) best = p;
  return best?.value ?? null;
}
/** σ of 1-minute log returns over the 4 h before the event, scaled to horizon h (√time) */
export function preEventSigma(xs: Point[], eventMs: number, hMin: number): number | null {
  const r: number[] = [];
  for (let t = eventMs - 240 * 60_000; t < eventMs; t += 60_000) {
    const a = at(xs, t), b = at(xs, t + 60_000);
    if (a && b) r.push(Math.log(b / a));
  }
  if (r.length < 60) return null;
  const mu = r.reduce((s, x) => s + x, 0) / r.length;
  return Math.sqrt(r.reduce((s, x) => s + (x - mu) ** 2, 0) / (r.length - 1)) * Math.sqrt(hMin);
}

export function surpriseClass(surprisePp: number): "baseline" | "bearish" | "bullish" {
  if (Math.abs(surprisePp) < IN_LINE_PP) return "baseline";
  return surprisePp > 0 ? "bearish" : "bullish";
}
const leanDir = (lean: string | null | undefined): Dir | null => (lean === "bullish" ? "up" : lean === "bearish" ? "down" : lean === "mixed" ? "flat" : null);
const classDir = (c: string): Dir => (c === "bullish" ? "up" : c === "bearish" ? "down" : "flat");

export type RunIn = { id: string; scenario: string; lean: string | null; assets: string[] };
export type Row = { asset: string; horizonMin: number; status: "evaluated" | "no_data"; ret: number | null; z: number | null; realized: Dir | null; realizedClass: string; mirofishRun: string | null; mirofishCall: Dir | null; baselineCall: Dir | null; mirofishHit: boolean | null; baselineHit: boolean | null };

export function evaluateEvent(input: { eventMs: number; surprisePp: number; runs: RunIn[]; prices: Record<string, Point[]> }) {
  const cls = surpriseClass(input.surprisePp);
  const rows: Row[] = [];
  for (const [asset, xs] of Object.entries(input.prices)) {
    // gold's sign convention: a hot print is read as bearish for risk assets; gold is reported, not scored against it
    for (const h of HORIZONS) {
      const p0 = at(xs, input.eventMs), p1 = at(xs, input.eventMs + h * 60_000), sig = preEventSigma(xs, input.eventMs, h);
      const pm = at(xs, input.eventMs - 60 * 60_000);
      if (!p0 || !p1 || !sig) { rows.push({ asset, horizonMin: h, status: "no_data", ret: null, z: null, realized: null, realizedClass: cls, mirofishRun: null, mirofishCall: null, baselineCall: null, mirofishHit: null, baselineHit: null }); continue; }
      const ret = Math.log(p1 / p0), z = ret / sig;
      const realized: Dir = Math.abs(z) < MOVE_Z ? "flat" : ret > 0 ? "up" : "down";
      const implied = classDir(cls);
      const realizedClass = implied !== "flat" && realized !== "flat" && realized !== implied ? "unexpected" : cls;
      const run = input.runs.find((r) => r.scenario === realizedClass && r.assets.includes(asset)) ?? null;
      const mirofishCall = run ? leanDir(run.lean) : null;
      const baselineCall: Dir = implied !== "flat" ? implied : pm ? (p0 > pm ? "up" : p0 < pm ? "down" : "flat") : "flat";
      rows.push({ asset, horizonMin: h, status: "evaluated", ret: Number(ret.toFixed(6)), z: Number(z.toFixed(3)), realized, realizedClass, mirofishRun: run?.id ?? null, mirofishCall, baselineCall, mirofishHit: mirofishCall ? mirofishCall === realized : null, baselineHit: baselineCall === realized });
    }
  }
  const ev = rows.filter((r) => r.status === "evaluated");
  const rate = (k: "mirofishHit" | "baselineHit") => { const xs = ev.filter((r) => r[k] != null); return { n: xs.length, hits: xs.filter((r) => r[k]).length }; };
  return { surpriseClass: cls, surprisePp: input.surprisePp, rows, mirofish: rate("mirofishHit"), baseline: rate("baselineHit"), caveat: "one event, 5 correlated assets × 3 overlapping horizons: anecdotal; no significance claimed; nothing feeds trading" };
}
