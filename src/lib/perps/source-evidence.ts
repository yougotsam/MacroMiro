/**
 * Convert stored, timestamped official macro actual-vs-consensus records into
 * perps research evidence. This does NOT forecast a directional win rate.
 * It validates issuer URL, asset relevance, pre-release forecast time and
 * actual publication <= our receipt <= decision. A source URL is provenance,
 * not a claim that this machine re-fetched that website.
 */
import type { SourceEvidence } from "./sniper-evidence";
import type { MacroRelease } from "./intel";

const officialIssuers = new Set([
  "bls.gov", "www.bls.gov", "bea.gov", "www.bea.gov",
  "federalreserve.gov", "www.federalreserve.gov",
  "eia.gov", "www.eia.gov", "treasury.gov", "home.treasury.gov",
  "census.gov", "www.census.gov", "ecb.europa.eu",
  "bankofengland.co.uk", "www.bankofengland.co.uk",
]);
const asset = (ticker: string) => ticker.replace(/^KX/, "").replace(/PERP$/, "").toUpperCase();
const when = (s: string) => Date.parse(s);
const issuer = (url: string) => {
  try { const u = new URL(url); return u.protocol === "https:" && officialIssuers.has(u.hostname.toLowerCase()); }
  catch { return false; }
};

export function sourcedMacroForPerp(
  ticker: string, decisionMs: number, releases: MacroRelease[],
): SourceEvidence[] {
  const a = asset(ticker);
  if (!Number.isFinite(decisionMs)) return [];
  const out: SourceEvidence[] = [];
  for (const e of releases) {
    const pub = when(e.publishedAt), seen = when(e.detectedAt), forecast = when(e.forecastAt);
    if (!e.assets.includes(a) || !issuer(e.officialUrl) ||
        !e.forecastUrl.startsWith("https://") ||
        ![pub, seen, forecast, e.actual, e.consensus, e.surpriseStd].every(Number.isFinite) ||
        e.surpriseStd <= 0 || forecast > pub || seen < pub || seen > decisionMs ||
        decisionMs - pub > 6 * 3_600_000) continue;
    out.push({ provider: "official", primaryUrl: e.officialUrl, asset: a,
      publishedMs: pub, receivedMs: seen, direction: "neutral", primaryVerified: true });
  }
  return out;
}
