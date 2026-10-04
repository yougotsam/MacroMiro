import type { BookId } from "@/lib/live/types";

export type UpDownLeg = "up" | "down";
export type UpDownChip = "late-window" | "mom-gap" | "settle-ta";

export type UpDownRound = {
  slug: string;
  question: string;
  url: string;
  start: number;
  end: number;
  leftSec: number;
  beat: number;
  spot: number;
  moveBps: number;
  up: number;
  down: number;
  yesBid?: number;
  winner: UpDownLeg | "tie";
  decided: boolean;
  take: boolean;
  leg: UpDownLeg | null;
  chip: UpDownChip | null;
  reason: string;
  confirms?: number;
  missing?: string | null;
  venue: "binance" | "kalshi";
  ticker?: string;
  result?: "yes" | "no" | null;
  book?: BookId;
  series?: string;
  /** Index already through the line. Pay the ask. Quiet books rest. */
  cross?: boolean;
  /** Calendar shock. 20¢–40¢ ticket at four times the clip. */
  catalyst?: boolean;
};

export function markYes(sizeUsd: number, entry: number, now: number, _fee = 0.02) {
  if (!entry) return 0;
  const contracts = sizeUsd / entry;
  return Number((contracts * (now - entry)).toFixed(2));
}

/** Global Polymarket 5m — US cannot trade this. Watch stub only. */
export async function loadRound(_force = false): Promise<UpDownRound> {
  const now = Math.floor(Date.now() / 1000);
  const start = Math.floor(now / 300) * 300;
  return {
    slug: "poly-global-5m",
    question: "Polymarket Global 5m — not this account",
    url: "https://polymarket.com",
    start,
    end: start + 300,
    leftSec: Math.max(0, start + 300 - now),
    beat: 0,
    spot: 0,
    moveBps: 0,
    up: 0.5,
    down: 0.5,
    winner: "tie",
    decided: false,
    take: false,
    leg: null,
    chip: null,
    reason: "Global 5m · US cannot trade · sit",
    venue: "binance",
  };
}
