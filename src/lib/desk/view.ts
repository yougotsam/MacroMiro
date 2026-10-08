import { existsSync, readFileSync } from "node:fs";
import { dataDir } from "./config";

/** Read-only view of the desk engine's last tick (status.json). The web app never places orders. */
export type DeskSeriesView = { series: string; ticker: string; tte: number; p: number | null; pBase: number | null; gate: string; best: { side: "yes" | "no"; mode: string; price: number; edge: number } | null };
export type DeskStatus = { ts: string; model: string; tickId: number; feeds: string; exchangeTradingActive: boolean; switches: { live: boolean; begin: boolean; arm: boolean }; latched: unknown; snapshot: Record<string, number> | null; series: DeskSeriesView[] };

export function readDeskStatus(maxAgeMs = 30_000): DeskStatus | null {
  const f = `${dataDir()}/status.json`;
  if (!existsSync(f)) return null;
  try {
    const s = JSON.parse(readFileSync(f, "utf8")) as DeskStatus;
    if (Date.now() - Date.parse(s.ts) > maxAgeMs) return null;
    return s;
  } catch {
    return null;
  }
}
