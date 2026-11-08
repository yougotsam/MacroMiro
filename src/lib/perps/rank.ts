/**
 * Cross-market ranker for perps candidates. Score = executable after-cost expectancy per $ risked (using the measured
 * hit rate when there is evidence, else 0 = unknown), plus liquidity, invalidation distance, reward multiple and
 * evidence quality. Research intel enters only as an EXPERIMENTAL additive term with its own trace.
 */
export type RankInput = {
  ticker: string; dir: "long" | "short"; decision: string; winNetUsd: number | null; lossNetUsd: number | null; riskUsd: number;
  measuredHitRate: number | null; evidenceN: number; spreadPct: number | null; depthMultiple: number; stopAtrMultiple: number | null;
  intelScore?: number; intelWeight?: number;
};
export function rankScore(x: RankInput) {
  const p = x.measuredHitRate;
  const priced = x.winNetUsd != null && x.lossNetUsd != null;
  const exp = p == null || !priced || x.riskUsd <= 0 ? 0 : (p * x.winNetUsd! + (1 - p) * x.lossNetUsd!) / x.riskUsd;
  const liq = Math.min(1, x.depthMultiple / 10) - Math.min(1, (x.spreadPct ?? 1) / 0.2);
  const inval = x.stopAtrMultiple == null ? 0 : x.stopAtrMultiple >= 0.75 && x.stopAtrMultiple <= 2.5 ? 0.3 : -0.3;
  const reward = priced && x.lossNetUsd! < 0 ? Math.min(3, x.winNetUsd! / -x.lossNetUsd!) / 3 : 0;
  const evidence = Math.min(1, x.evidenceN / 200);
  const intel = (x.intelScore ?? 0) * (x.intelWeight ?? 0);
  const score = +(2 * exp * evidence + 0.5 * liq + inval + 0.5 * reward + intel).toFixed(4);
  return { score, parts: { expectancyPerR: +exp.toFixed(4), evidence, liquidity: +liq.toFixed(3), invalidation: inval, reward: +reward.toFixed(3), intel: +intel.toFixed(4) } };
}

/** The existing scanner's cross-market view. No inferred probability or automatic trade authorization. */
import type { PerpsCandidate } from "./candidates";
import { qualifyPerpsSniper } from "./sniper-evidence";

export function rankPerpsCandidates(candidates: PerpsCandidate[]) {
  const rows = candidates.map((c) => {
    const win = c.payoff.winUsdNet, loss = c.payoff.lossUsdNet;
    const rr = win != null && loss != null && win > 0 && loss < 0 ? +(win / -loss).toFixed(3) : null;
    const received = Date.parse(c.receivedAt), decided = Date.parse(c.decidedAt);
    const priority = qualifyPerpsSniper({
      ticker: c.ticker, dir: c.dir, decisionMs: decided,
      venueBook: c.executionClass === "venue_book" && c.timeSource === "caller" && c.gates.book_fresh?.pass === true,
      venueTrading: c.gates.market_open?.pass === true,
      quoteAgeMs: Number.isFinite(received) && Number.isFinite(decided) ? decided - received : null,
      spreadBps: c.spreadPct == null ? null : c.spreadPct * 100,
      depthMultiple: c.gates.depth?.pass === true ? 3 : null,
      score13: c.score, structureAligned: c.gates.setup?.pass === true && c.gates.confluence_9?.pass === true,
      validStop: c.stop != null && c.target2 != null && c.qtyContracts > 0,
      macroBlocked: false, winNetUsd: win, lossNetUsd: loss, forecast: null, sources: [],
    });
    return {
      ticker: c.ticker,
      dir: c.dir,
      setup: c.setup,
      ready: c.decision === "RESEARCH_CANDIDATE" && c.executionClass === "venue_book" && c.timeSource === "caller",
      score13: c.score,
      sniperStage: priority.stage,
      researchPriority: priority.researchPriority,
      sniperBlockers: priority.blockers,
      netRR: rr,
      breakEvenWinRate: c.payoff.breakEvenWinRate,
      probability: "UNMEASURED" as const,
      spreadPct: c.spreadPct,
      blockers: Object.entries(c.gates).filter(([, g]) => !g.pass).map(([k]) => k),
    };
  });
  rows.sort((a, b) =>
    Number(b.ready) - Number(a.ready)
    || b.researchPriority - a.researchPriority
    || (a.breakEvenWinRate ?? Infinity) - (b.breakEvenWinRate ?? Infinity)
    || b.score13 - a.score13
    || (a.spreadPct ?? Infinity) - (b.spreadPct ?? Infinity)
    || a.ticker.localeCompare(b.ticker));
  return rows.map((r, i) => ({ rank: i + 1, ...r }));
}
