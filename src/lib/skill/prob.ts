/** Uncalibrated. A score from indicators is not this number. */

export type ProbRead = {
  modelPYes: number | null;
  modelPNo: number | null;
  marketPYes: number | null;
  marketPNo: number | null;
  fee: number | null;
  spread: number | null;
  slippage: number;
  latencyAllowance: number;
  netEdge: number | null;
  confidence: "none" | "experimental";
  uncertainty: string;
  label: "unavailable" | "Experimental estimate";
  bullish: string[];
  bearish: string[];
  contradictions: string[];
  noTrade: string[];
  book: "btc" | "gold";
  regime: string;
};

function cdf(z: number) {
  const s = z < 0 ? -1 : 1;
  const a = Math.abs(z);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a));
  return 0.5 * (1 + s * y);
}

export function estimateProb(input: {
  book: "btc" | "gold";
  regime: string;
  spot: number | null;
  beat: number | null;
  volBps: number | null;
  leftSec: number | null;
  yesAsk: number | null;
  yesBid: number | null;
  noAsk: number | null;
  feedOk: boolean;
  calibrated: boolean;
  bullish?: string[];
  bearish?: string[];
}): ProbRead {
  const noTrade: string[] = [];
  const contradictions: string[] = [];
  const bullish = input.bullish ?? [];
  const bearish = input.bearish ?? [];
  if (!input.calibrated) noTrade.push("not calibrated");
  if (!input.feedOk || input.spot == null || input.beat == null) noTrade.push("no settlement spot");
  if (input.volBps == null || input.volBps <= 0) noTrade.push("no volatility");
  if (input.leftSec == null) noTrade.push("no time left");
  const marketPYes = input.yesAsk;
  const marketPNo = input.noAsk;
  const spread = input.yesAsk != null && input.yesBid != null ? Number((input.yesAsk - input.yesBid).toFixed(4)) : null;
  if (spread == null) noTrade.push("no executable book");
  if (bullish.length && bearish.length) contradictions.push("bullish and bearish evidence both present");

  const base = {
    book: input.book,
    regime: input.regime,
    marketPYes,
    marketPNo,
    spread,
    slippage: 0.01,
    latencyAllowance: 0.005,
    bullish,
    bearish,
    contradictions,
  };

  if (noTrade.some((r) => r !== "not calibrated") || input.spot == null || input.beat == null || !input.volBps || input.leftSec == null || marketPYes == null) {
    return {
      ...base,
      modelPYes: null,
      modelPNo: null,
      fee: null,
      netEdge: null,
      confidence: "none",
      uncertainty: "missing input",
      label: "unavailable",
      noTrade,
    };
  }

  const mins = Math.max(input.leftSec / 60, 1 / 60);
  const moveBps = ((input.spot - input.beat) / input.beat) * 10_000;
  const z = moveBps / (input.volBps * Math.sqrt(mins));
  const modelPYes = Math.min(0.97, Math.max(0.03, cdf(z)));
  const modelPNo = 1 - modelPYes;
  const p = Math.min(0.99, Math.max(0.01, marketPYes));
  const fee = Math.ceil(0.07 * p * (1 - p) * 100) / 100;
  const gross = modelPYes - marketPYes;
  const netEdge = Number((gross - fee - (spread ?? 0) / 2 - 0.01 - 0.005).toFixed(4));
  if (netEdge < 0.03) noTrade.push(`net ${netEdge} < 0.03`);
  noTrade.push("not calibrated");
  return {
    ...base,
    modelPYes: Number(modelPYes.toFixed(4)),
    modelPNo: Number(modelPNo.toFixed(4)),
    fee,
    netEdge,
    confidence: "experimental",
    uncertainty: "normal CDF, not fit on settled Kalshi windows",
    label: "Experimental estimate",
    noTrade,
  };
}
