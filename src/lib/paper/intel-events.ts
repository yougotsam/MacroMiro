/**
 * Reusable timestamped intelligence-event evaluator (replaces the hard-coded Bitget trace).
 * Rules: information counts for a decision only if it was DETECTED by us at or before the decision time
 * (publication alone is not availability). "Priced in" is only stated with market evidence (quotes for the
 * same asset before and after detection); otherwise it is "unknown".
 */
export type IntelEvent = {
  id: string; title: string; url: string; source: string; assets: string[];
  publishedAt: string | null; detectedAt: string; direction: "up" | "down" | null; credits: number;
};
export type QuotePoint = { ts: string; series: string; mid: number };

const ASSET_SERIES: Record<string, string> = { BTC: "KXBTC15M", ETH: "KXETH15M", SOL: "KXSOL15M", XRP: "KXXRP15M", GOLD: "KXGOLD15M" };
export const seriesFor = (asset: string) => ASSET_SERIES[asset.toUpperCase()] ?? null;

export function availableAt(e: IntelEvent, decisionTs: string) {
  const d = Date.parse(decisionTs), det = Date.parse(e.detectedAt);
  if (!Number.isFinite(d) || !Number.isFinite(det)) return { available: false, reason: "bad timestamp" };
  if (det > d) return { available: false, reason: `detected ${Math.round((det - d) / 60000)} min after the decision` };
  return { available: true, reason: `detected ${Math.round((d - det) / 60000)} min before the decision` };
}

export function eventsFor(series: string, decisionTs: string, events: IntelEvent[], maxAgeMs = 6 * 3_600_000) {
  return events.filter((e) => e.assets.some((a) => seriesFor(a) === series) && availableAt(e, decisionTs).available && Date.parse(decisionTs) - Date.parse(e.detectedAt) <= maxAgeMs);
}

/** Market evidence only: mean mid move of the asset's contracts in the 15 min after detection vs the 15 min before. */
export function pricedIn(e: IntelEvent, quotes: QuotePoint[]) {
  const det = Date.parse(e.detectedAt);
  const series = e.assets.map(seriesFor).filter(Boolean) as string[];
  const near = quotes.filter((q) => series.includes(q.series));
  const before = near.filter((q) => Date.parse(q.ts) < det && det - Date.parse(q.ts) <= 900_000);
  const after = near.filter((q) => Date.parse(q.ts) >= det && Date.parse(q.ts) - det <= 900_000);
  if (!before.length || !after.length) return { verdict: "unknown", reason: "no quotes for this asset both before and after detection" };
  const m = (xs: QuotePoint[]) => xs.reduce((a, x) => a + x.mid, 0) / xs.length;
  return { verdict: "measured", midBefore: +m(before).toFixed(4), midAfter: +m(after).toFixed(4), n: [before.length, after.length], reason: "15-minute contracts reset each window; a mid change is evidence of movement, not proof of cause" };
}

export function evaluateEvent(e: IntelEvent, decisionTs: string, quotes: QuotePoint[]) {
  const avail = availableAt(e, decisionTs);
  const delayH = e.publishedAt ? +((Date.parse(e.detectedAt) - Date.parse(e.publishedAt)) / 3_600_000).toFixed(2) : null;
  return { id: e.id, decisionTs, ...avail, publicationToDetectionHours: delayH, pricedIn: pricedIn(e, quotes), usableDirection: avail.available ? e.direction : null };
}
