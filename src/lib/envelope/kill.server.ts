import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DATA_ROOT } from "@/lib/data-root";

const FILE = `${DATA_ROOT}/kill.json`;
const LIVE_FILE = "/workspace/.grok/secrets/kalshi_live";
const BEGIN_FILE = "/workspace/.grok/secrets/kalshi_begin";

export const DAILY_LOSS_CAP = 15;
export const MAX_EXPOSURE_USD = 20;
export const MAX_PER_TICKER_USD = 5;
export const LIVE_CLIP_USD = 1;
export const SCALE_AFTER_RESOLVED = 100;
export const LOSS_STREAK = 3;
export const LOSS_PAUSE_MS = 60 * 60_000;

export type KillState = {
  armed: boolean;
  liveEnabled: boolean;
  dailyLossUsd: number;
  dailyLossDate: string;
  consecutiveLosses: number;
  pauseUntil: number;
  stale: boolean;
  reason: string;
  updatedAt: string;
};

const DEFAULT: KillState = {
  armed: false,
  liveEnabled: false,
  dailyLossUsd: 0,
  dailyLossDate: todayEt(),
  consecutiveLosses: 0,
  pauseUntil: 0,
  stale: false,
  reason: "not begun",
  updatedAt: new Date().toISOString(),
};

function todayEt() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function ensureDir() {
  mkdirSync(DATA_ROOT, { recursive: true });
}

export function readKill(): KillState {
  try {
    if (!existsSync(FILE)) return { ...DEFAULT };
    const raw = JSON.parse(readFileSync(FILE, "utf8")) as KillState;
    const day = todayEt();
    if (raw.dailyLossDate !== day) {
      return saveKill({
        ...DEFAULT,
        ...raw,
        dailyLossUsd: 0,
        dailyLossDate: day,
        consecutiveLosses: 0,
        liveEnabled: liveFlagOn(),
      });
    }
    return { ...DEFAULT, ...raw, liveEnabled: liveFlagOn() };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveKill(next: KillState): KillState {
  ensureDir();
  const state = { ...next, liveEnabled: liveFlagOn(), updatedAt: new Date().toISOString() };
  writeFileSync(FILE, JSON.stringify(state, null, 2));
  return state;
}

export function setArmedKill(armed: boolean, reason: string) {
  const k = readKill();
  k.armed = armed;
  k.reason = reason;
  return saveKill(k);
}

export function markStale(stale: boolean, reason: string) {
  const k = readKill();
  k.stale = stale;
  k.reason = reason;
  return saveKill(k);
}

export function recordPnl(delta: number) {
  const k = readKill();
  const day = todayEt();
  if (k.dailyLossDate !== day) {
    k.dailyLossUsd = 0;
    k.dailyLossDate = day;
  }
  if (delta < 0) {
    k.dailyLossUsd = Number((k.dailyLossUsd + Math.abs(delta)).toFixed(2));
    k.consecutiveLosses += 1;
    if (k.consecutiveLosses >= LOSS_STREAK) {
      k.pauseUntil = Date.now() + LOSS_PAUSE_MS;
      k.consecutiveLosses = 0;
      k.reason = `${LOSS_STREAK} losses in a row · pause 60 min`;
    }
  } else if (delta > 0) {
    k.consecutiveLosses = 0;
  }
  return saveKill(k);
}

export function disableLiveFlag() {
  try {
    mkdirSync("/workspace/.grok/secrets", { recursive: true });
    writeFileSync(LIVE_FILE, "0\n");
  } catch {
    /* */
  }
}

/** Same switch as kalshi-auth. Both must stay in agreement: file is exactly "1". */
export function liveFlagOn() {
  try {
    return existsSync(LIVE_FILE) && readFileSync(LIVE_FILE, "utf8").trim() === "1";
  } catch {
    return false;
  }
}

export function beginFlagOn() {
  try {
    return existsSync(BEGIN_FILE) && readFileSync(BEGIN_FILE, "utf8").trim() === "1";
  } catch {
    return false;
  }
}

/** Orders leave only when the path file is exactly 1 and the begin file is exactly 1. */
export function executionFromFlags(live: boolean, begun: boolean) {
  return live && begun;
}

export function liveExecutionAllowed() {
  return executionFromFlags(liveFlagOn(), beginFlagOn());
}

export function killBlocksTrade(exposureUsd: number): { ok: boolean; why: string } {
  if (!liveFlagOn()) return { ok: false, why: "live path off" };
  if (!beginFlagOn()) return { ok: false, why: "not begun" };
  const k = readKill();
  if (!k.armed) return { ok: false, why: "ARM off" };
  if (k.stale) return { ok: false, why: `stale · ${k.reason}` };
  if (k.dailyLossUsd >= DAILY_LOSS_CAP) return { ok: false, why: `daily loss ${k.dailyLossUsd}` };
  if (exposureUsd >= MAX_EXPOSURE_USD) return { ok: false, why: `exposure ${exposureUsd}` };
  return { ok: true, why: "scan ok" };
}
