import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { CLIP_USD, START_CASH, clampClip } from "./clip";
import type { BookScan } from "./board";
import type { PaperPos, PaperRow } from "./paper";
import type { BookId } from "@/lib/live/types";
import type { UpDownLeg, UpDownRound } from "@/lib/scan/updown";
import { DATA_ROOT } from "@/lib/data-root";

const FILE = `${DATA_ROOT}/heart.json`;
const LEGACY = "/workspace/.grok/paper.json";
const TMP_LEGACY = "/tmp/envelope-paper.json";

export type RestingBid = {
  orderId: string;
  ticker: string;
  leg: UpDownLeg;
  yes: number;
  book: BookId;
  beat: number;
  slotEnd: number;
  chip: string;
  sizeUsd: number;
};

export type HeartState = {
  armed: boolean;
  clipUsd: number;
  cash: number;
  pos: PaperPos | null;
  positions: PaperPos[];
  ledger: PaperRow[];
  book: BookId;
  board: BookScan[];
  lastTick: string | null;
  lastNote: string;
  lastFill: string | null;
  ticks: number;
  fills: number;
  lastOpenAt: number;
  round?: UpDownRound | null;
  live?: boolean;
  resting?: RestingBid[];
};

const EMPTY: HeartState = {
  armed: false,
  clipUsd: CLIP_USD,
  cash: START_CASH,
  pos: null,
  positions: [],
  ledger: [],
  book: "btc",
  board: [],
  lastTick: null,
  lastNote: "idle",
  lastFill: null,
  ticks: 0,
  fills: 0,
  lastOpenAt: 0,
  round: null,
  live: false,
};

type G = typeof globalThis & { __envelopeHeartMem?: HeartState };

function readDisk(): HeartState | null {
  for (const path of [FILE, LEGACY, TMP_LEGACY]) {
    try {
      if (!existsSync(path)) continue;
      const data = JSON.parse(readFileSync(path, "utf8")) as HeartState;
      if (typeof data.cash !== "number") continue;
      const positions = Array.isArray(data.positions) ? data.positions : data.pos ? [data.pos] : [];
      return {
        ...EMPTY,
        ...data,
        clipUsd: clampClip(data.clipUsd || CLIP_USD),
        ledger: Array.isArray(data.ledger) ? data.ledger.slice(0, 200) : [],
        positions,
        pos: positions[0] ?? null,
        board: Array.isArray(data.board) ? data.board : [],
        resting: Array.isArray(data.resting) ? data.resting : [],
      };
    } catch {
      /* next */
    }
  }
  return null;
}

export function loadHeart(): HeartState {
  const g = globalThis as G;
  if (g.__envelopeHeartMem) return g.__envelopeHeartMem;
  const disk = readDisk();
  g.__envelopeHeartMem = disk ?? { ...EMPTY };
  return g.__envelopeHeartMem;
}

export function heartFingerprint(state: HeartState) {
  return JSON.stringify({
    a: state.armed,
    c: state.cash,
    f: state.fills,
    clip: state.clipUsd,
    p: state.positions,
    lid: state.ledger[0]?.id ?? null,
  });
}

export function saveHeart(state: HeartState, persist = true) {
  state.pos = state.positions[0] ?? null;
  (globalThis as G).__envelopeHeartMem = state;
  if (!persist) return;
  try {
    mkdirSync(DATA_ROOT, { recursive: true });
    const tmp = `${FILE}.tmp`;
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, FILE);
  } catch {
    try {
      mkdirSync("/workspace/.grok", { recursive: true });
      writeFileSync(LEGACY, JSON.stringify(state));
    } catch {
      /* memory still holds */
    }
  }
}