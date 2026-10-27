/**
 * The perpetual plan. Numbers only. This file does not send.
 * Kalshi closes a perp with a stop and a target on the position.
 * A stop is not a liquidation.
 */
import { KILL_FRAC, LOSS_STREAK, TRADE_FRAC } from "../desk/guard";

export const SCAN = [
  { ticker: "KXBTCPERP", name: "Bitcoin" },
  { ticker: "KXETHPERP", name: "Ether" },
  { ticker: "KXSOLPERP", name: "Solana" },
  { ticker: "KXXRPPERP", name: "XRP" },
  { ticker: "KXGOLDPERP", name: "Gold" },
  { ticker: "KXSILVERPERP", name: "Silver" },
  { ticker: "KXUS500PERP", name: "S&P 500" },
] as const;

export type Side = "long" | "short";

export function bracket(entry: number, sweep: number, side: Side): { stop: number; takeHalf: number; takeRest: number } | null {
  if (!(entry > 0) || !(sweep > 0)) return null;
  const risk = Math.abs(entry - sweep);
  if (!(risk > 0)) return null;
  if (side === "long") {
    const stop = Math.min(entry, sweep);
    if (!(stop < entry)) return null;
    const r = entry - stop;
    return { stop, takeHalf: entry + r, takeRest: entry + 2.5 * r };
  }
  const stop = Math.max(entry, sweep);
  if (!(stop > entry)) return null;
  const r = stop - entry;
  return { stop, takeHalf: entry - r, takeRest: entry - 2.5 * r };
}

export function bias(input: {
  sweep: "low" | "high" | null;
  gap: "yes" | "no" | null;
  funding: number | null;
  spread: number | null;
}): { side: Side; why: string } | null {
  if (input.spread != null && input.spread > 0.0015) return null;
  const funding = input.funding ?? 0;
  if (input.sweep === "low" && input.gap === "yes" && funding < 0.0005) {
    return { side: "long", why: "swept the low, gap up, funding not charging longs" };
  }
  if (input.sweep === "high" && input.gap === "no" && funding > -0.0005) {
    return { side: "short", why: "swept the high, gap down, funding not charging shorts" };
  }
  return null;
}

/** A click is not an entry. Missing sweep, gap, or pile is a no. */
export function mayFire(input: {
  ticker: string;
  side: Side;
  sweep: "low" | "high" | null;
  gap: "yes" | "no" | null;
  funding: number | null;
  spread: number | null;
  pileUsd: number;
  clipUsd: number;
  stopLossPctOfClip: number;
  downUsd: number;
  lossesInARow: number;
}): { ok: true } | { ok: false; why: string } {
  if (!SCAN.some((s) => s.ticker === input.ticker)) return { ok: false, why: "not on the scan list" };
  const call = bias({ sweep: input.sweep, gap: input.gap, funding: input.funding, spread: input.spread });
  if (!call) return { ok: false, why: "no sweep, no gap, or funding is fighting the side" };
  if (call.side !== input.side) return { ok: false, why: "the click does not match the setup" };
  if (!(input.pileUsd > 0)) return { ok: false, why: "pile unread" };
  if (input.lossesInARow >= LOSS_STREAK) return { ok: false, why: "three losses in a row, day is done" };
  if (input.downUsd >= input.pileUsd * KILL_FRAC) return { ok: false, why: "account is down 25%" };
  const loss = input.clipUsd * (input.stopLossPctOfClip / 100);
  if (!(loss > 0) || loss > input.pileUsd * TRADE_FRAC + 1e-6) return { ok: false, why: "stop risk is over 15% of the pile" };
  return { ok: true };
}
