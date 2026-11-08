/**
 * Macro Miro perps sniper evidence gate. This pure function never sends orders.
 *
 * A technical setup may be promising with no fills yet. It is NOT a measured
 * P(target-before-stop | filled). A model must earn that separate claim on
 * timestamp-correct, out-of-sample venue outcomes. Kalshi 15m settlement
 * probabilities must not be passed to this perps gate.
 */
export type ForecastEvidence = {
  task: "perps_target_before_stop_filled";
  modelId: string;
  pHit: number | null;
  conservativeLower95: number | null;
  oosTrades: number;
  brier: number | null;
  benchmarkBrier: number | null;
  observedUntilMs: number;
  evaluatedAtMs: number;
  independentHoldout: boolean;
};
export type SourceEvidence = {
  provider: "official" | "firecrawl" | "spark" | "alexandria" | "mirofish";
  primaryUrl: string | null;
  asset: string;
  publishedMs: number | null;
  receivedMs: number;
  direction: "supports" | "opposes" | "neutral" | "unknown";
  primaryVerified: boolean;
};
export type SniperInput = {
  ticker: string;
  dir: "long" | "short";
  decisionMs: number;
  venueBook: boolean;
  venueTrading: boolean;
  quoteAgeMs: number | null;
  spreadBps: number | null;
  depthMultiple: number | null;
  score13: number;
  structureAligned: boolean;
  validStop: boolean;
  macroBlocked: boolean;
  winNetUsd: number | null;
  lossNetUsd: number | null;
  forecast: ForecastEvidence | null;
  sources: SourceEvidence[];
};
export type SniperResult = {
  stage: "VETO" | "PAPER_ONLY" | "MODEL_QUALIFIED";
  researchPriority: number;
  breakEvenP: number | null;
  evidenceP: number | null;
  conservativeP: number | null;
  conservativeEvUsd: number | null;
  independentPrimarySources: number;
  blockers: string[];
  /** Never means the OMS is approved to send; owner, risk, watchdog, fills, and venue are separate. */
  authorizesLiveOrder: false;
};

const finite = (v: number | null): v is number => v !== null && Number.isFinite(v);
const round = (v: number) => Number(v.toFixed(6));
const isP = (v: number | null) => finite(v) && v >= 0 && v <= 1;

/** Sources are not votes. Count unique independently timestamped PRIMARY documents. */
export function independentSources(x: SniperInput): SourceEvidence[] {
  const byUrl = new Map<string, SourceEvidence>();
  for (const s of x.sources) {
    if (!s.primaryVerified || !s.primaryUrl?.startsWith("https://") || !finite(s.publishedMs) ||
        !Number.isFinite(s.receivedMs) || s.publishedMs > s.receivedMs ||
        s.receivedMs > x.decisionMs || x.decisionMs - s.publishedMs > 6 * 3_600_000 ||
        s.asset.toUpperCase() !== x.ticker.replace(/^KX|PERP$/g, "").toUpperCase()) continue;
    const prev = byUrl.get(s.primaryUrl);
    if (!prev || s.receivedMs < prev.receivedMs) byUrl.set(s.primaryUrl, s);
  }
  return [...byUrl.values()];
}

export function qualifyPerpsSniper(x: SniperInput): SniperResult {
  const blockers: string[] = [];
  const sources = independentSources(x);
  // A priority for research and paper-trade sequencing only, never P(win).
  const tech = Number.isFinite(x.score13) ? Math.max(0, Math.min(13, x.score13)) : 0;
  const bookGrade = x.venueBook && x.venueTrading && finite(x.quoteAgeMs) && x.quoteAgeMs >= 0 && x.quoteAgeMs <= 3_000 ? 1 : 0;
  const depthGrade = finite(x.depthMultiple) && x.depthMultiple >= 3 ? 1 : 0;
  const sourceGrade = Math.min(2, sources.length) / 2;
  const priority = round(Math.min(100, 65 * tech / 13 + 20 * (bookGrade + depthGrade) / 2 + 15 * sourceGrade));

  if (!x.venueBook || !x.venueTrading || !bookGrade) blockers.push("venue_book_not_fresh_or_closed");
  if (!finite(x.spreadBps) || x.spreadBps < 0 || x.spreadBps > 8) blockers.push("spread_gt_8bps_or_unknown");
  if (!depthGrade) blockers.push("depth_lt_3x_or_unknown");
  if (!x.validStop || !x.structureAligned || tech < 9) blockers.push("setup_or_invalidation_not_confirmed");
  if (x.macroBlocked) blockers.push("scheduled_macro_lockout");
  if (sources.some(s => s.direction === "opposes")) blockers.push("verified_primary_macro_disagreement");
  const win = x.winNetUsd, loss = x.lossNetUsd;
  const priced = finite(win) && finite(loss) && win > 0 && loss < 0;
  const be = priced ? -loss / (win - loss) : null;
  if (!priced) blockers.push("after_cost_payoff_unknown");

  const f = x.forecast;
  const modelOkay = f !== null &&
    f.task === "perps_target_before_stop_filled" &&
    !!f.modelId && f.independentHoldout &&
    Number.isSafeInteger(f.oosTrades) && f.oosTrades >= 200 &&
    isP(f.pHit) && isP(f.conservativeLower95) &&
    f.conservativeLower95! <= f.pHit! &&
    finite(f.brier) && finite(f.benchmarkBrier) &&
    f.brier < f.benchmarkBrier &&
    Number.isFinite(f.observedUntilMs) && Number.isFinite(f.evaluatedAtMs) &&
    f.observedUntilMs < f.evaluatedAtMs && f.evaluatedAtMs <= x.decisionMs &&
    x.decisionMs - f.evaluatedAtMs <= 7 * 86_400_000;
  if (!modelOkay) blockers.push("perps_probability_not_oos_calibrated");

  const lower = modelOkay ? f!.conservativeLower95! : null;
  const ev = priced && lower !== null ? round(lower * win! + (1 - lower) * loss!) : null;
  // High-probability preference and 2 percentage points over cost break-even
  // are explicit research thresholds, not a learned or guaranteed edge.
  if (modelOkay && (lower! < 0.60 || be === null || lower! < be + 0.02 || !(ev! > 0)))
    blockers.push("conservative_probability_or_ev_below_threshold");

  const hard = blockers.some(b => b !== "perps_probability_not_oos_calibrated");
  const stage = hard ? "VETO" : !modelOkay ? "PAPER_ONLY" : "MODEL_QUALIFIED";
  return {
    stage, researchPriority: priority, breakEvenP: be == null ? null : round(be),
    evidenceP: modelOkay ? f!.pHit : null,
    conservativeP: lower, conservativeEvUsd: ev,
    independentPrimarySources: sources.length, blockers,
    authorizesLiveOrder: false,
  };
}
