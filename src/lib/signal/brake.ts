/**
 * Losing-streak brake (MMM #126 risk overlay). After `after` settled losses in a row the next size is cut by
 * `factor`; a win resets it. The existing rule still ends the day at three losses in a row.
 * Settings live in signal/config.ts.
 */
import { STREAK_BRAKE } from "./config";

export function lossesInARow(pnls: number[]): number {
  let n = 0;
  for (let i = pnls.length - 1; i >= 0; i--) {
    if (pnls[i] < 0) n++;
    else if (pnls[i] > 0) break;
  }
  return n;
}

export function brakeCount(count: number, losses: number, brake = STREAK_BRAKE): number {
  if (!brake || losses < brake.after) return count;
  return Math.floor(count * brake.factor);
}
