/**
 * The measured model file (data/signal/model.json, written by scripts/signal-train.ts) and the per-asset bar file.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Model } from "./model";
import type { Report } from "./backtest";
import type { Bar } from "./ta";
import type { NewsHistory } from "./features";
import { readTone } from "./news";
import type { Asset } from "./news";

export type SignalModelFile = {
  builtAt: string;
  model: Model;
  entryCut: { prediction: number; perp: number };
  priors?: Record<string, { weight: number; why: string }>;
  verdict: { prediction: Report; perp: Report };
  assumptions: string;
};

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const SIGNAL_DIR = () => process.env.SIGNAL_DIR || `${REPO_ROOT}/data/signal`;

export const PRODUCT_OF: Record<string, string> = { BTC: "BTC-USD", ETH: "ETH-USD", SOL: "SOL-USD", XRP: "XRP-USD", GOLD: "XAU-USD" };
export const ASSET_OF_SERIES: Record<string, "BTC" | "ETH" | "SOL" | "XRP" | "GOLD"> = { KXBTC15M: "BTC", KXETH15M: "ETH", KXSOL15M: "SOL", KXXRP15M: "XRP", KXGOLD15M: "GOLD" };

let cache: { at: number; file: SignalModelFile | null } = { at: -Infinity, file: null };
export function loadSignalModel(now = Date.now(), path = `${SIGNAL_DIR()}/model.json`): SignalModelFile | null {
  if (now - cache.at < 60_000) return cache.file;
  let file: SignalModelFile | null = null;
  try {
    const j = JSON.parse(readFileSync(path, "utf8")) as SignalModelFile;
    if (j?.model?.weights?.length && j.verdict?.prediction && j.verdict?.perp && j.entryCut) file = j;
  } catch {
    file = null;
  }
  cache = { at: now, file };
  return file;
}

export function readBars(asset: string, dir = SIGNAL_DIR()): Bar[] {
  const f = `${dir}/bars/${PRODUCT_OF[asset]}-15m.jsonl`;
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Bar);
}

const histCache = new Map<string, { at: number; h: NewsHistory }>();
/** Headline tone for one asset plus the Fed/inflation tone, re-read at most every 10 minutes. */
export function readNewsHistory(asset: Asset, now = Date.now(), dir = SIGNAL_DIR()): NewsHistory {
  const c = histCache.get(asset);
  if (c && now - c.at < 600_000) return c.h;
  const h = { toneAsset: readTone(dir, asset), toneMacro: readTone(dir, "MACRO") };
  histCache.set(asset, { at: now, h });
  return h;
}
