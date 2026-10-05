import { readFileSync, writeFileSync } from "node:fs";

const FILE = "data/perp-slider.json";

/** Known contract maximums when the live book has not answered yet. The live book wins when it has. */
export const PERP_LEV_CAP: Record<string, number> = {
  KXGOLDPERP: 15.2,
  KXSILVERPERP: 8.3,
  KXBTCPERP: 6.4,
  KXETHPERP: 4.8,
  KXSOLPERP: 4,
  KXXRPPERP: 4,
  KXBNBPERP: 4,
  KXUS500PERP: 8,
};

/** Breathing room. Not the maximum. */
export const PERP_LEV_DEFAULT: Record<string, number> = {
  KXGOLDPERP: 5,
  KXBTCPERP: 4,
  KXETHPERP: 3,
  KXSILVERPERP: 3,
  KXSOLPERP: 3,
  KXXRPPERP: 3,
  KXBNBPERP: 3,
  KXUS500PERP: 3,
};

export function readSlider(): Record<string, number> {
  try {
    const parsed = JSON.parse(readFileSync(FILE, "utf8")) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (n >= 1 && n <= 20) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeSlider(ticker: string, leverage: number) {
  const all = readSlider();
  all[ticker] = Math.min(20, Math.max(1, leverage));
  writeFileSync(FILE, JSON.stringify(all));
}

/** The number on the slider. Never above the live contract maximum. */
export function sliderCeiling(ticker: string, liveMax: number) {
  const max = liveMax >= 1 ? liveMax : (PERP_LEV_CAP[ticker] ?? 5);
  const chosen = readSlider()[ticker] ?? PERP_LEV_DEFAULT[ticker] ?? Math.min(3, max);
  return Math.min(Math.max(1, chosen), max);
}
