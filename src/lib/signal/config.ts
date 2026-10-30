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
