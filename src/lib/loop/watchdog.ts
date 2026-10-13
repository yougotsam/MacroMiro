/**
 * Risk watchdog core (pure + small file IO). The PROCESS lives in scripts/loop/watchdog.ts (own PID). It shares no
 * memory with the engine: it reads positions/ledger files and writes only its heartbeat, the paper kill file and
 * STATE.md incidents. Fail-closed: if the heartbeat is missing/stale/unreadable, `watchdogFresh()` is false and the
 * engine must refuse NEW entries (exits/flattens are always allowed).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { P } from "./paths";

export const HEARTBEAT_EVERY_MS = 60_000;
export const HEARTBEAT_STALE_MS = 3 * HEARTBEAT_EVERY_MS; // 3 missed polls → stale
/**
 * HARD DRAWDOWN LIMIT — PENDING OWNER DECISION. Paper default = the existing top perps warning (50%,
 * mandate.ts drawdownWarnPct). Override with WATCHDOG_DD_LIMIT_PCT for paper experiments only.
 */
export const DD_LIMIT_PENDING_OWNER_DECISION = true;
export const DEFAULT_DD_LIMIT_PCT = 50;
export const KALSHI_DAY_STOP_USD = -15; // approved; Kalshi 15m only (paper/portfolio.ts LIMITS.dayStop)
export function ddLimitPct() { const v = Number(process.env.WATCHDOG_DD_LIMIT_PCT); return Number.isFinite(v) && v > 0 && v <= 100 ? v : DEFAULT_DD_LIMIT_PCT; }

export type Heartbeat = { pid: number; at: string; seq: number; mode: "paper"; ddLimitPct: number; ddLimitStatus: "PENDING_OWNER_DECISION" | "OWNER_SET"; last: WatchResult | null };
export type WatchResult = { kalshi: { dayRealizedUsd: number; openUsd: number; stopUsd: number; breached: boolean }; perps: { equityUsd: number | null; peakUsd: number | null; ddPct: number | null; breached: boolean; positions: number }; actions: string[] };

export function writeHeartbeat(h: Heartbeat) { const f = P.heartbeat(); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f + ".tmp", JSON.stringify(h)); writeFileSync(f, JSON.stringify(h)); }
export function readHeartbeat(): Heartbeat | null { try { return JSON.parse(readFileSync(P.heartbeat(), "utf8")) as Heartbeat; } catch { return null; } }
export function watchdogFresh(now = Date.now(), staleMs = HEARTBEAT_STALE_MS): { ok: boolean; why: string } {
  if (!existsSync(P.heartbeat())) return { ok: false, why: "watchdog heartbeat missing" };
  const h = readHeartbeat(); if (!h) return { ok: false, why: "watchdog heartbeat unreadable" };
  const t = Date.parse(h.at); if (!Number.isFinite(t) || t > now + 5_000) return { ok: false, why: "watchdog heartbeat timestamp invalid" };
  if (now - t > staleMs) return { ok: false, why: `watchdog heartbeat stale (${Math.round((now - t) / 1000)}s)` };
  return { ok: true, why: "watchdog fresh" };
}

/** Kalshi 15m paper: daily stop on realized ET-day P&L → flatten every open paper position (not just block entries). */
export function kalshiStop(dayRealizedUsd: number, openUsd: number, stop = KALSHI_DAY_STOP_USD) {
  return { dayRealizedUsd: +dayRealizedUsd.toFixed(2), openUsd: +openUsd.toFixed(2), stopUsd: stop, breached: dayRealizedUsd <= stop };
}
/** Perps paper: peak-to-trough drawdown on equity vs the hard limit. */
export function perpsDrawdown(equity: number | null, peak: number | null, limitPct = ddLimitPct()) {
  if (equity == null || peak == null || !(peak > 0)) return { ddPct: null, breached: false };
  const dd = ((peak - equity) / peak) * 100;
  return { ddPct: +dd.toFixed(2), breached: dd >= limitPct };
}
