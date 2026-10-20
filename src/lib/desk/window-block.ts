/**
 * Refuse a new buy in a clock window the scorecard has already shown losing.
 * A window is blocked only when at least 15 settled contracts have a negative after-fee result.
 * The block lifts itself when that stops being true. It does not raise a cap.
 */
import { existsSync, readFileSync } from "node:fs";
import { dataDir } from "./config";
import { seriesWindows } from "../deskc/exclusion";
import { lastPerTicker, type RawDecision } from "../deskc/retro";
import { tteBucket } from "../deskc/scorecard";

let blocked = new Set<string>();

export function windowRefusal(series: string, tteSec: number): string | null {
  const key = `${series}|${tteBucket(tteSec)}`;
  if (!blocked.has(key)) return null;
  return `G2_window_${series}_${tteBucket(tteSec)}`;
}

export function setWindowBlocks(keys: Iterable<string>): void {
  blocked = new Set(keys);
}

export function windowBlockKeys(): string[] {
  return [...blocked];
}

function lines(path: string): unknown[] {
  if (!existsSync(path)) return [];
  const out: unknown[] = [];
  for (const l of readFileSync(path, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      out.push(JSON.parse(l) as unknown);
    } catch {
      /* a torn last line is ignored */
    }
  }
  return out;
}

/** Recompute from the decision log. One row per contract, same population as the daily report. */
export function refreshWindowBlocks(dir = dataDir()): string[] {
  const decisions = lines(`${dir}/decisions.jsonl`) as RawDecision[];
  const outcomes = new Map<string, "yes" | "no">();
  for (const o of lines(`${dir}/outcomes.jsonl`) as { ticker?: string; result?: string }[]) {
    if (o.ticker && (o.result === "yes" || o.result === "no")) outcomes.set(o.ticker, o.result);
  }
  const keys = seriesWindows(lastPerTicker(decisions, outcomes))
    .filter((w) => w.excluded)
    .map((w) => `${w.series}|${w.bucket}`);
  blocked = new Set(keys);
  return keys;
}
