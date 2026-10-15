/**
 * Timestamped research attached to a candidate. A missing or failed source is UNKNOWN.
 * This does not turn a headline into a win probability.
 */
export type ResearchFeature = {
  name: string;
  eventAt: string | null;
  source: string;
  state: "known" | "UNKNOWN";
  value: string | number | null;
  horizon: string;
};

export function researchTrace(input: {
  mirofish?: { headline?: string; probability?: number | null; at?: number; stage?: string; source?: string } | null;
  spark?: { status?: string; at?: string; error?: string } | null;
}): ResearchFeature[] {
  const m = input.mirofish;
  const swarmOk = !!m && m.probability != null && m.at != null && !String(m.stage ?? "").startsWith("error");
  const s = input.spark;
  const sparkOk = !!s && s.status === "complete" && !s.error && !!s.at;
  return [
    { name: "mirofish_scenario", eventAt: m?.at != null ? new Date(m.at).toISOString() : null, source: m?.source ?? "mirofish", state: swarmOk ? "known" : "UNKNOWN", value: swarmOk ? m!.probability! : null, horizon: "next decision" },
    { name: "spark_catalyst", eventAt: s?.at ?? null, source: "spark-2", state: sparkOk ? "known" : "UNKNOWN", value: sparkOk ? s!.status! : null, horizon: "next decision" },
  ];
}
