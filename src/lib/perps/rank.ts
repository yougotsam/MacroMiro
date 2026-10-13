/**
 * Cross-market ranker for perps candidates. Score = executable after-cost expectancy per $ risked (using the measured
 * hit rate when there is evidence, else 0 = unknown), plus liquidity, invalidation distance, reward multiple and
 * evidence quality. Research intel enters only as an EXPERIMENTAL additive term with its own trace.
 */
export type RankInput = {
  ticker: string; dir: "long" | "short"; decision: string; winNetUsd: number; lossNetUsd: number; riskUsd: number;
  measuredHitRate: number | null; evidenceN: number; spreadPct: number | null; depthMultiple: number; stopAtrMultiple: number | null;
  intelScore?: number; intelWeight?: number;
};
export function rankScore(x: RankInput) {
  const p = x.measuredHitRate;
  const exp = p == null || x.riskUsd <= 0 ? 0 : (p * x.winNetUsd + (1 - p) * x.lossNetUsd) / x.riskUsd;
  const liq = Math.min(1, x.depthMultiple / 10) - Math.min(1, (x.spreadPct ?? 1) / 0.2);
  const inval = x.stopAtrMultiple == null ? 0 : x.stopAtrMultiple >= 0.75 && x.stopAtrMultiple <= 2.5 ? 0.3 : -0.3;
  const reward = x.lossNetUsd < 0 ? Math.min(3, x.winNetUsd / -x.lossNetUsd) / 3 : 0;
  const evidence = Math.min(1, x.evidenceN / 200);
  const intel = (x.intelScore ?? 0) * (x.intelWeight ?? 0);
  const score = +(2 * exp * evidence + 0.5 * liq + inval + 0.5 * reward + intel).toFixed(4);
  return { score, parts: { expectancyPerR: +exp.toFixed(4), evidence, liquidity: +liq.toFixed(3), invalidation: inval, reward: +reward.toFixed(3), intel: +intel.toFixed(4) } };
}
