/**
 * Research features (Phase 8). Each is computed only from stored, timestamped evidence; anything missing is
 * PENDING/UNAVAILABLE, never filled in. Default model weight is 0 for all of them: they are evaluated for incremental
 * value against the validated Kalshi model before any use, and none of them can change a probability or an order.
 */
export const FEATURE_NAMES = ["MACRO_SURPRISE", "NARRATIVE_CHANGE", "SOURCE_DISAGREEMENT", "EVENT_NOVELTY", "CATALYST_CONCENTRATION", "SCENARIO_DISAGREEMENT", "RELEASE_REVISION", "REGULATORY_IMPACT", "NEWS_LATENCY"] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureValue = { name: FeatureName; status: "OK" | "PENDING" | "UNAVAILABLE"; value: number | null; label?: string; evidence: string[]; weight: 0; evaluation: "NOT_EVALUATED" };

export type FeatureInput = {
  actual?: number | null; consensus?: number | null; consensusSource?: string | null; actualSource?: string | null;
  diffChangedShare?: number | null; diffSource?: string | null;
  sourceValues?: { source: string; value: number }[];
  seenHashes?: Set<string>; eventHash?: string;
  eventsNext24h?: number | null;
  scenarioLeans?: string[]; mirofishReportId?: string | null;
  revisions?: number | null; revisionSource?: string | null;
  regulatoryHits?: { url: string; agency: string }[] | null;
  publishedAt?: string | null; detectedAt?: string | null;
};

function f(name: FeatureName, value: number | null, evidence: string[], label?: string, status?: FeatureValue["status"]): FeatureValue {
  return { name, status: status ?? (value === null ? "PENDING" : "OK"), value, ...(label ? { label } : {}), evidence, weight: 0, evaluation: "NOT_EVALUATED" };
}

export function computeFeatures(i: FeatureInput): FeatureValue[] {
  const out: FeatureValue[] = [];
  out.push(i.actual != null && i.consensus != null && i.actualSource && i.consensusSource ? f("MACRO_SURPRISE", Math.round((i.actual - i.consensus) * 1000) / 1000, [i.actualSource, i.consensusSource]) : f("MACRO_SURPRISE", null, []));
  out.push(i.diffChangedShare != null && i.diffSource ? f("NARRATIVE_CHANGE", Math.round(i.diffChangedShare * 100) / 100, [i.diffSource]) : f("NARRATIVE_CHANGE", null, []));
  const vals = i.sourceValues ?? [];
  if (vals.length >= 2) {
    const nums = vals.map((v) => v.value);
    out.push(f("SOURCE_DISAGREEMENT", Math.max(...nums) - Math.min(...nums), vals.map((v) => v.source)));
  } else out.push(f("SOURCE_DISAGREEMENT", null, []));
  out.push(i.seenHashes && i.eventHash ? f("EVENT_NOVELTY", i.seenHashes.has(i.eventHash) ? 0 : 1, [i.eventHash]) : f("EVENT_NOVELTY", null, []));
  out.push(i.eventsNext24h != null ? f("CATALYST_CONCENTRATION", i.eventsNext24h, ["official calendar"]) : f("CATALYST_CONCENTRATION", null, []));
  if (i.scenarioLeans && i.scenarioLeans.length >= 2 && i.mirofishReportId) {
    const distinct = new Set(i.scenarioLeans).size;
    out.push(f("SCENARIO_DISAGREEMENT", (distinct - 1) / (i.scenarioLeans.length - 1), [i.mirofishReportId], "SIMULATED: MiroFish agents are not real traders"));
  } else out.push(f("SCENARIO_DISAGREEMENT", null, [], "SIMULATED"));
  out.push(i.revisions != null && i.revisionSource ? f("RELEASE_REVISION", i.revisions, [i.revisionSource]) : f("RELEASE_REVISION", null, []));
  out.push(i.regulatoryHits ? f("REGULATORY_IMPACT", i.regulatoryHits.length, i.regulatoryHits.map((h) => h.url)) : f("REGULATORY_IMPACT", null, []));
  const p = Date.parse(i.publishedAt ?? "");
  const d = Date.parse(i.detectedAt ?? "");
  out.push(Number.isFinite(p) && Number.isFinite(d) ? (d >= p ? f("NEWS_LATENCY", Math.round((d - p) / 1000), ["publication vs detection timestamps"]) : f("NEWS_LATENCY", null, [], "detected before published: timestamp error", "UNAVAILABLE")) : f("NEWS_LATENCY", null, []));
  return out;
}
