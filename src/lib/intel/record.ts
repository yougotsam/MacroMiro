export type CatalystRecord = {
  catalystId: string;
  asset: "btc" | "gold" | "both" | "unclear";
  contractTicker: string;
  eventType: string;
  headline: string;
  summary: string;
  firstSeenAt: string;
  publishedAt: string | null;
  discoveredAt: string;
  sourceUrls: string[];
  primarySourceUrls: string[];
  directQuotes: string[];
  sourceQuality: "primary" | "secondary" | "unknown";
  corroborationCount: number;
  contradictionScore: number;
  noveltyScore: number;
  bullishEvidence: string[];
  bearishEvidence: string[];
  affectedHorizon: "immediate" | "15m" | "session" | "unknown";
  confidence: "low" | "medium" | "none";
  experimentalProbabilityDelta: number | null;
  probabilityDeltaReason: string;
  sparkJobIds: string[];
  traceIds: string[];
  snapshotIds: string[];
  creditsUsed: number | null;
  marketStateAtDiscovery: "not from firecrawl";
  laterOutcome: null;
  trade: false;
  contractBlock: boolean;
  phase: "planning" | "working" | "finalizing" | "done" | "failed";
};

const PRIMARY = /federalreserve\.gov|bls\.gov|eia\.gov|treasury\.gov|kalshi\.com|docs\.kalshi\.com|cfbenchmarks\.com|pyth\.network/i;

export function emptyRecord(id: string, now: string): CatalystRecord {
  return {
    catalystId: id,
    asset: "unclear",
    contractTicker: "",
    eventType: "unspecified",
    headline: "",
    summary: "",
    firstSeenAt: now,
    publishedAt: null,
    discoveredAt: now,
    sourceUrls: [],
    primarySourceUrls: [],
    directQuotes: [],
    sourceQuality: "unknown",
    corroborationCount: 0,
    contradictionScore: 0,
    noveltyScore: 0,
    bullishEvidence: [],
    bearishEvidence: [],
    affectedHorizon: "unknown",
    confidence: "none",
    experimentalProbabilityDelta: null,
    probabilityDeltaReason: "missing news is unknown",
    sparkJobIds: [],
    traceIds: [],
    snapshotIds: [],
    creditsUsed: null,
    marketStateAtDiscovery: "not from firecrawl",
    laterOutcome: null,
    trade: false,
    contractBlock: false,
    phase: "planning",
  };
}

export function applyFinding(
  base: CatalystRecord,
  finding: {
    headline?: string;
    summary?: string;
    asset?: string;
    quotes?: string[];
    urls?: string[];
    publishedAt?: string | null;
    bullish?: string[];
    bearish?: string[];
    recycled?: boolean;
    rulesChanged?: boolean;
    jobId?: string;
    credits?: number | null;
  },
): CatalystRecord {
  const urls = (finding.urls ?? []).filter(Boolean);
  const primary = urls.filter((u) => PRIMARY.test(u));
  const bull = finding.bullish ?? [];
  const bear = finding.bearish ?? [];
  const contradictionScore = bull.length && bear.length ? 0.8 : finding.recycled ? 0.6 : primary.length === 0 && urls.length > 0 ? 0.5 : 0;
  const corroborated = primary.length >= 1 && contradictionScore < 0.6;
  const delta = corroborated && bull.length !== bear.length ? (bull.length > bear.length ? 0.02 : -0.02) : null;
  const asset = finding.asset === "btc" || finding.asset === "gold" || finding.asset === "both" ? finding.asset : "unclear";
  return {
    ...base,
    asset,
    headline: (finding.headline || base.headline).slice(0, 180),
    summary: (finding.summary || base.summary).slice(0, 400),
    publishedAt: finding.publishedAt ?? null,
    sourceUrls: [...new Set([...base.sourceUrls, ...urls])],
    primarySourceUrls: [...new Set([...base.primarySourceUrls, ...primary])],
    directQuotes: [...new Set([...(finding.quotes ?? []).map((q) => q.slice(0, 180))])],
    sourceQuality: primary.length ? "primary" : urls.length ? "secondary" : "unknown",
    corroborationCount: primary.length,
    contradictionScore,
    noveltyScore: finding.recycled ? 0.1 : primary.length ? 0.7 : 0.3,
    bullishEvidence: bull,
    bearishEvidence: bear,
    affectedHorizon: primary.length ? "15m" : "unknown",
    confidence: corroborated ? "low" : "none",
    experimentalProbabilityDelta: delta,
    probabilityDeltaReason: delta == null ? "missing news is unknown, or the sources disagree" : "experimental only. not a calibrated probability. not an order.",
    sparkJobIds: finding.jobId ? [...new Set([...base.sparkJobIds, finding.jobId])] : base.sparkJobIds,
    creditsUsed: finding.credits ?? base.creditsUsed,
    contractBlock: Boolean(finding.rulesChanged),
    trade: false,
    marketStateAtDiscovery: "not from firecrawl",
    laterOutcome: null,
  };
}
