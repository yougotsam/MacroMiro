import type { PlayId } from "./opinion";
import type { BookId, Regime } from "@/lib/live/types";

export type BookScan = {
  book: BookId;
  last: number;
  stacked: "long" | "short" | "chop";
  rsi: number | null;
  stretch: number;
  n: number;
  action: PlayId;
  auto: boolean;
  reason: string;
  open: boolean;
  regime?: Regime;
  adx?: number | null;
  side?: "long" | "short" | null;
};

export const BOOK_LABEL: Record<BookId, string> = {
  btc: "BTC",
  sol: "SOL",
  eth: "ETH",
  xrp: "XRP",
  gold: "GC",
  silver: "SI",
  es: "ES",
  oil: "CL",
};