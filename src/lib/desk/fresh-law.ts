/**
 * The only entry law. Indicators name the side before any order is considered.
 * A settlement chance is not an entry. This file does not send.
 */
import { ema, rsi } from "./features";

/** One trade may post at most this fraction of the cash in the pile being used. */
export const PILE_TRADE = 0.04;
/** The day stops when losses reach this fraction of that same pile. */
export const PILE_DAY = 0.08;

export function freshCall(closes: number[]): { side: "yes" | "no"; why: string } | null {
  if (closes.length < 22) return null;
  const fast = ema(closes, 9);
  const slow = ema(closes, 21);
  const strength = rsi(closes, 14);
  if (fast == null || slow == null || strength == null) return null;
  const last = closes[closes.length - 1];
  const prev = closes[closes.length - 2];
  if (fast > slow && prev <= fast && last > fast && strength >= 52 && strength <= 68) {
    return { side: "yes", why: "9 above 21, retest held, strength 52-68" };
  }
  if (fast < slow && prev >= fast && last < fast && strength >= 32 && strength <= 48) {
    return { side: "no", why: "9 below 21, retest held, strength 32-48" };
  }
  return null;
}

/** Dollars this pile may still risk. Unknown cash is zero, which means no order. */
export function pileRoom(cash: number, dayWorst: number): number {
  if (!(cash > 0) || !Number.isFinite(dayWorst)) return 0;
  const trade = cash * PILE_TRADE;
  const dayLeft = cash * PILE_DAY + dayWorst;
  const room = Math.min(trade, dayLeft, cash);
  return room > 0 ? Math.floor(room * 10_000) / 10_000 : 0;
}
