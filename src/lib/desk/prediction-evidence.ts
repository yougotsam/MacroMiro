/**
 * Independent evidence grading for Kalshi binary contracts.
 * Unlike a directional candle experiment, every scored record is tied to an
 * actual market ticker, a timestamped executable fill and Kalshi's final result.
 * Nothing here routes an order or approves a model.
 */
export type PredictionFillEvidence = {
  ticker: string;
  modelVersion: string;
  datasetSplitId: string;
  datasetHash: string;
  decisionMs: number;
  quoteMs: number;
  fillMs: number;
  closeMs: number;
  settlementMs: number;
  side: "yes" | "no";
  yesProbability: number | null;
  filledPriceUsd: number;
  quantity: number;
  totalFeesUsd: number;
  result: "yes" | "no" | "void" | "undetermined";
  settlementSource: string;
  oos: boolean;
};
export type GradedPrediction = {
  ticker: string;
  modelVersion: string;
  split: string;
  netUsd: number;
  modelBrier: number | null;
  entryBrier: number;
  result: "yes" | "no";
  oos: boolean;
};
export type Grade = { ok: true; data: GradedPrediction } | { ok: false; reason: string };

export function gradePredictionFill(r: PredictionFillEvidence, maxQuoteAgeMs = 3000): Grade {
  if (!r.ticker || !r.modelVersion || !r.datasetSplitId || !r.datasetHash || !r.settlementSource.startsWith("https://"))
    return { ok: false, reason: "missing ticker, immutable model/data provenance or settlement source" };
  if (typeof r.oos !== "boolean") return { ok: false, reason: "holdout provenance absent" };
  const times = [r.quoteMs, r.decisionMs, r.fillMs, r.closeMs, r.settlementMs];
  if (!times.every(Number.isFinite) || !(r.quoteMs <= r.decisionMs && r.decisionMs <= r.fillMs &&
    r.fillMs <= r.closeMs && r.closeMs <= r.settlementMs && r.decisionMs - r.quoteMs <= maxQuoteAgeMs))
    return { ok: false, reason: "quote/fill/settlement timestamps inconsistent or quote stale" };
  if (r.result !== "yes" && r.result !== "no")
    return { ok: false, reason: "market has no final YES/NO settlement" };
  if (!Number.isSafeInteger(r.quantity) || r.quantity < 1 ||
    !Number.isFinite(r.filledPriceUsd) || !(r.filledPriceUsd > 0 && r.filledPriceUsd < 1) ||
    !Number.isFinite(r.totalFeesUsd) || r.totalFeesUsd < 0)
    return { ok: false, reason: "fill price, contract count or actual fees invalid" };
  const p = r.yesProbability;
  if (p !== null && (!Number.isFinite(p) || p < 0 || p > 1))
    return { ok: false, reason: "invalid model YES probability" };
  const win = r.side === r.result;
  const label = r.result === "yes" ? 1 : 0;
  const marketP = r.side === "yes" ? r.filledPriceUsd : 1 - r.filledPriceUsd;
  return { ok: true, data: {
    ticker: r.ticker,
    modelVersion: r.modelVersion, split: r.datasetSplitId,
    netUsd: +((win ? r.quantity : 0) - r.quantity * r.filledPriceUsd - r.totalFeesUsd).toFixed(6),
    modelBrier: p === null ? null : +((p - label) ** 2).toFixed(6),
    entryBrier: +((marketP - label) ** 2).toFixed(6),
    result: r.result, oos: r.oos,
  } };
}

/** No result without a genuine final settlement. No assumption that a 51c proxy filled. */
export function gradePredictionBatch(rows: PredictionFillEvidence[]) {
  const graded = rows.map((r) => gradePredictionFill(r));
  const valid = graded.filter((g): g is Extract<Grade, { ok: true }> => g.ok).map((g) => g.data);
  const oos = valid.filter((g) => g.oos);
  const scored = oos.filter((g) => g.modelBrier != null);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  return {
    total: rows.length,
    accepted: valid.length,
    rejected: graded.length - valid.length,
    rejectionReasons: graded.filter((g): g is Extract<Grade, { ok: false }> => !g.ok).map((g) => g.reason),
    oosTrades: oos.length,
    netOosUsd: +sum(oos.map((g) => g.netUsd)).toFixed(6),
    meanOosUsd: oos.length ? +(sum(oos.map((g) => g.netUsd)) / oos.length).toFixed(6) : null,
    modelBrier: scored.length ? +(sum(scored.map((g) => g.modelBrier!)) / scored.length).toFixed(6) : null,
    marketBrierSameRows: scored.length ? +(sum(scored.map((g) => g.entryBrier)) / scored.length).toFixed(6) : null,
    status: "RESEARCH_ONLY_NOT_AN_APPROVAL" as const,
  };
}
