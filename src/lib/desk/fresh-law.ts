/**
 * The only entry law. Indicators name the side before any order is considered.
 * A settlement chance is not an entry. This file does not send.
 */
import { ema, rsi } from "./features";
import { KILL_FRAC, TRADE_FRAC } from "./guard";

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
  const trade = cash * TRADE_FRAC;
  const killLeft = cash * KILL_FRAC + dayWorst;
  const room = Math.min(trade, killLeft, cash);
  return room > 0 ? Math.floor(room * 10_000) / 10_000 : 0;
}
