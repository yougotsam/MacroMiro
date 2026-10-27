/**
 * GUARD. Plain code. It owns size, the day halt, and the kill switch.
 * It does not send, and it does not invent a probability.
 *
 * REFLEX may name a side. GUARD decides whether that side is allowed to become an order.
 * News is not an input here. A headline cannot flip fire to true.
 */

/** Loss posted on one trade, as a fraction of the pile. */
export const TRADE_FRAC = 0.01;
/** Day halt. Tighter than the prompt's example. Escalation may tighten this. It may not loosen it. */
export const DAY_FRAC = 0.04;
/** Kill switch. The prompt's 15% example is too loose for a $100–$200 pile. */
export const KILL_FRAC = 0.1;

export type Regime = "trend" | "mean_rev" | "high_vol" | "crisis";
export type RiskState = "safe" | "near_limit" | "reduce";

export type GuardVerdict = {
  regime: Regime;
  direction: "long" | "short" | "neutral";
  setup_q: 0 | 1 | 2 | 3;
  risk_state: RiskState;
  /** Null until a measured, out-of-sample probability exists. Never a guess. */
  p: number | null;
  fire: boolean;
  why: string;
};

export function guardVerdict(input: {
  side: "yes" | "no" | null;
  cash: number;
  dayWorst: number;
  /** True only after a separate review of an out-of-sample log. Default false. */
  kept: boolean;
  /** A probability fit on settled outcomes. Null if it has not been measured. */
  calibratedP: number | null;
}): GuardVerdict {
  const direction = input.side === "yes" ? "long" : input.side === "no" ? "short" : "neutral";
  const setup_q = input.side ? 2 : 0;
  const cash = input.cash;
  const draw = cash > 0 ? -input.dayWorst / cash : 1;
  const risk_state: RiskState = draw >= KILL_FRAC ? "reduce" : draw >= DAY_FRAC ? "near_limit" : "safe";
  const regime: Regime = risk_state === "reduce" ? "crisis" : "trend";
  const base = { regime, direction, setup_q, risk_state, p: input.calibratedP, fire: false as boolean };
  if (!input.side) return { ...base, why: "no setup" };
  if (!input.kept) return { ...base, why: "not kept by review" };
  if (input.calibratedP == null || !(input.calibratedP > 0)) return { ...base, why: "probability not measured" };
  if (!(cash > 0)) return { ...base, why: "pile unread" };
  if (risk_state !== "safe") return { ...base, why: `risk ${risk_state}` };
  return { ...base, fire: true, why: "kept and measured" };
}
