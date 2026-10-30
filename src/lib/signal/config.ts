/**
 * Signal settings. Sameer's blank numbers stay blank: they are named here with no value, and nothing in this
 * folder fills or assumes them. The live risk checks in desk/risk.ts are what enforce money limits.
 */
export const OWNER_BLANKS: Readonly<{
  depositUsd: number | null;
  predictionPerpSplit: number | null;
  maxLossPerTradeUsd: number | null;
  dayStopUsd: number | null;
}> = Object.freeze({ depositUsd: null, predictionPerpSplit: null, maxLossPerTradeUsd: null, dayStopUsd: null });

/** Two losses in a row halve the next size; a win resets it. Three still ends the day (desk/risk.ts). */
export const STREAK_BRAKE: { after: number; factor: number } | null = Object.freeze({ after: 2, factor: 0.5 });

/**
 * MiroFish has no scored history yet (3 finished scenario runs, all for one release), so its weight cannot be
 * measured. Until ≥ 30 runs are scored against the real move (scripts/mirofish-score.ts), it gets this fixed,
 * documented prior: log-odds per unit of the swarm feature (−1..+1). 0.15 moves a 50% read to at most ~53.7%
 * at full conviction, or ~51.9% from a scenario direction (which counts half). Never a percent of its own.
 */
export const MIROFISH_PRIOR_WEIGHT = 0.15;
export const MIROFISH_PRIOR_WHY = "documented prior: no scored history yet (see config.ts); replaced by a measured weight after 30 scored runs";
