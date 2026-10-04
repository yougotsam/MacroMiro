import type { BookId } from "@/lib/live/types";

/** Frozen before the next search. Clip is margin. Lev is the futures-style multiple. */
export const CLIP_USD = 15;
export const CLIP_CHOICES = [5, 10, 15, 20] as const;
export type ClipUsd = (typeof CLIP_CHOICES)[number];
export const DAILY_STOP_USD = 150;
export const START_CASH = 300;
export const CASH_KILL = START_CASH - DAILY_STOP_USD;
export const POLY_TAKER = 0.016;
export const POLY_FEE_PLUS_CENTS = POLY_TAKER + 0.02;
/** Kalshi documented fee ≈ 7% of C·p·(1-p). Used on paper so it matches a live taker. */
export const FROZEN_N = 12;
export const MIN_DSR_PROB = 0.95;
/** Quiet book. Kept so older notes still compile. Live size is sniperClip. */
export const LIVE_CLIP_CAP = 2;
/** Index already through the line. The live sizer may still choose $1 to $5. */
export const LIVE_CROSS_USD = 4;

/** Under $50 the clip is $1 to $5. A cheap, fast ticket gets the larger clip. Never the whole balance. */
export function sniperClip(cash: number, price: number, strong: boolean): number {
  if (cash >= 100) return Math.min(20, Math.max(5, Math.round(cash * (strong ? 0.2 : 0.1))));
  if (cash >= 50) return Math.min(15, Math.max(5, Math.round(cash * (strong ? 0.15 : 0.1))));
  if (strong && price <= 0.35) return 5;
  if (strong) return 3;
  if (price <= 0.35) return 2;
  return 1;
}
export const LIVE_BOOK_CAP = 10;
export const MAX_SLOTS = 2;
export const STREAK_SIT = 3;
/** ATR/last below this is saw — skip. Matches 2026 syndicate 0.15% guard. */
export const ATR_CHOP = 0.0015;
/** Perp display only. KXBTC15M is NOT this. A 69¢ contract risks ~69¢ and pays $1. Payout multiple is 1/price, not LEV. */
export const LEV: Record<BookId, number> = {
  btc: 5,
  sol: 5,
  eth: 5,
  gold: 10,
  silver: 10,
  es: 10,
  oil: 10,
};

export function bucket(book: BookId): "crypto" | "metal" | "index" | "energy" {
  if (book === "btc" || book === "sol" || book === "eth") return "crypto";
  if (book === "gold" || book === "silver") return "metal";
  if (book === "es") return "index";
  return "energy";
}

export function notional(book: BookId, sizeUsd: number) {
  return sizeUsd * (LEV[book] ?? 5);
}

export function clampClip(n: number): ClipUsd {
  if (n >= 20) return 20;
  if (n >= 15) return 15;
  if (n >= 10) return 10;
  return 5;
}
