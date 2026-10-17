import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_ROOT } from "@/lib/data-root";
import { rungFor, type BankPreset } from "./flip";

export type ShadowFlip = {
  id: string;
  at: string;
  ticker: string;
  question: string;
  mode: string;
  side: "YES" | "NO";
  entry: number | null;
  target: number | null;
  multiple: number | null;
  status: "shadow";
  outcome: null;
};

export type FlipLedger = {
  version: 1;
  preset: BankPreset;
  trackedCash: number;
  flips: ShadowFlip[];
  updatedAt: string;
};

const FILE = () => join(process.env.MACROMIRO_DATA_DIR || DATA_ROOT, "flip-ledger.json");

export function emptyLedger(now = new Date().toISOString()): FlipLedger {
  return { version: 1, preset: 100, trackedCash: 100, flips: [], updatedAt: now };
}

export function readLedger(): FlipLedger {
  try {
    const raw = JSON.parse(readFileSync(FILE(), "utf8")) as Partial<FlipLedger>;
    const preset: BankPreset = raw.preset === "live" || raw.preset === 100 || raw.preset === 200 || raw.preset === 500 || raw.preset === 2500 ? raw.preset : 100;
    const tracked = Number(raw.trackedCash);
    return {
      version: 1,
      preset,
      trackedCash: Number.isFinite(tracked) ? tracked : preset === "live" ? 0 : preset,
      flips: Array.isArray(raw.flips) ? raw.flips.slice(-200) : [],
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    };
  } catch {
    return emptyLedger();
  }
}

export function writeLedger(next: FlipLedger) {
  const path = FILE();
  mkdirSync(process.env.MACROMIRO_DATA_DIR || DATA_ROOT, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(next));
  renameSync(tmp, path);
}

export function applyPreset(current: FlipLedger, preset: BankPreset, liveCash: number | null, now = new Date().toISOString()): FlipLedger {
  const trackedCash = preset === "live" ? (liveCash ?? current.trackedCash) : preset;
  return { ...current, preset, trackedCash, updatedAt: now };
}

export function pushShadow(current: FlipLedger, flip: Omit<ShadowFlip, "id" | "at" | "status" | "outcome">, now = new Date().toISOString()): FlipLedger {
  const row: ShadowFlip = { ...flip, id: `${Date.now()}`, at: now, status: "shadow", outcome: null };
  return { ...current, flips: [...current.flips, row].slice(-200), updatedAt: now };
}

export function ledgerView(ledger: FlipLedger, liveCash: number | null) {
  const cash = ledger.preset === "live" && liveCash != null ? liveCash : ledger.trackedCash;
  return { ...ledger, liveCash, shownCash: cash, rung: rungFor(cash), sendsOrders: false as const };
}
