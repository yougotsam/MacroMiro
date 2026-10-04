import type { PlayId } from "@/lib/envelope/opinion";
import type { BookId } from "@/lib/live/types";
import type { BrokerChoice } from "@/lib/printgate/broker";
import type { TfId } from "@/lib/live/tf";
import type { TapeSettings } from "@/lib/live/indicators";

export const PAPER_KEY = "envelope.paper.v1";

export type PaperPos = {
  book: BookId;
  side: "long" | "short";
  entry: number;
  sizeUsd: number;
  opened: string;
  play: PlayId;
  venue?: "spot" | "poly5m" | "kalshi15m";
  ticker?: string;
  leg?: "up" | "down";
  slug?: string;
  beat?: number;
  slotEnd?: number;
  chip?: string;
  yes?: number;
  mode?: "paper" | "live";
  count?: number;
};

export type PaperRow = {
  id: string;
  ts: string;
  play: PlayId;
  note: string;
  delta: number;
};

export type PaperState = {
  cash: number;
  pos: PaperPos | null;
  ledger: PaperRow[];
  book: BookId;
  brokerId: BrokerChoice["id"];
  armed?: boolean;
  tf?: TfId;
  settings?: TapeSettings;
  clipUsd?: number;
};

export function loadPaper(): PaperState | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(PAPER_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as PaperState;
    if (typeof data.cash !== "number" || !Number.isFinite(data.cash)) return null;
    return data;
  } catch {
    return null;
  }
}

export function savePaper(state: PaperState) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PAPER_KEY, JSON.stringify(state));
  } catch {
    /* quota */
  }
}