/**
 * News and fundamentals as numbers the score can weigh. Nothing here fetches, calls a model, or reads free text
 * into a decision: it parses the snapshot files the research workers already write (Spark card, Alexandria,
 * MiroFish, the official release calendar) into bounded numbers. A missing or stale file gives 0 and
 * `present: false`; it never sits a ticket by itself and never invents a MiroFish percent.
 */
import { readFileSync } from "node:fs";
import { DATA_ROOT } from "@/lib/data-root";

export type Asset = "BTC" | "ETH" | "SOL" | "XRP" | "GOLD";
export type Release = { name: string; when: string; agency?: string };

const FRESH_MS = 6 * 3600_000;
const TIER1 = /FOMC|GDP|Gross Domestic Product, \d|Personal Income and Outlays|Employment Situation|Consumer Price Index|\bCPI\b/i;

export function tier1(events: Release[]): number[] {
  return events.filter((e) => TIER1.test(e.name)).map((e) => Date.parse(e.when)).filter(Number.isFinite).sort((a, b) => a - b);
}

/** 1 at a tier-1 release, falling to 0 at ±`windowMin` minutes. Uses only the schedule, which is known in advance. */
export function releaseProximity(times: number[], now: number, windowMin = 60): number {
  let best = Infinity;
  for (const t of times) {
    const d = Math.abs(t - now);
    if (d < best) best = d;
    if (t > now + windowMin * 60_000) break;
  }
  const w = windowMin * 60_000;
  return best >= w ? 0 : 1 - best / w;
}

/** Minutes until the next tier-1 release (Infinity if none scheduled). */
export function minutesToNextRelease(times: number[], now: number): number {
  for (const t of times) if (t >= now) return (t - now) / 60_000;
  return Infinity;
}

export type NewsDocs = {
  spark: Record<string, unknown> | null;
  alexandria: Record<string, unknown> | null;
  mirofish: Record<string, unknown> | null;
};

export type NewsRead = {
  /** −1 bearish .. +1 bullish for this asset, from a fresh Spark card. 0 if none. */
  sparkBias: number;
  sparkPresent: boolean;
  /** Alexandria / rates probability centred at 0 (−0.5..+0.5), only for rate-sensitive assets. */
  ratesTilt: number;
  ratesPresent: boolean;
  /** MiroFish swarm probability of "up", or null when it is down, stale, or gave none. Never invented. */
  mirofishP: number | null;
  mirofishState: "missing" | "down" | "stale" | "ok" | "no_direction";
};

function coversAsset(asset: Asset, s: string): boolean {
  const a = s.toLowerCase();
  if (a === "crypto") return asset !== "GOLD";
  if (a === "both") return asset === "BTC" || asset === "GOLD";
  if (a === "btc" || a === "bitcoin") return asset === "BTC";
  if (a === "eth" || a === "ethereum") return asset === "ETH";
  if (a === "sol" || a === "solana") return asset === "SOL";
  if (a === "xrp") return asset === "XRP";
  if (a === "gold" || a === "xau") return asset === "GOLD";
  return false;
}

export function readNews(asset: Asset, docs: NewsDocs, now: number): NewsRead {
  const out: NewsRead = { sparkBias: 0, sparkPresent: false, ratesTilt: 0, ratesPresent: false, mirofishP: null, mirofishState: "missing" };
  const spark = docs.spark;
  const card = spark?.card as { bias?: unknown; asset?: unknown; probability?: unknown } | undefined;
  const at = Date.parse(String(spark?.at ?? ""));
  if (spark?.status === "completed" && card && Number.isFinite(at) && now >= at && now - at < FRESH_MS && coversAsset(asset, String(card.asset ?? ""))) {
    const p = Number(card.probability);
    if (Number.isFinite(p) && p > 0 && p < 1) out.sparkBias = Math.max(-1, Math.min(1, (p - 0.5) * 2));
    else if (card.bias === "bullish") out.sparkBias = 0.5;
    else if (card.bias === "bearish") out.sparkBias = -0.5;
    out.sparkPresent = out.sparkBias !== 0;
  }
  const alex = docs.alexandria;
  const aAt = Date.parse(String(alex?.at ?? ""));
  const ap = Number(alex?.probability);
  if (asset === "GOLD" && Number.isFinite(aAt) && now >= aAt && now - aAt < 7 * 86_400_000 && ap > 0 && ap < 1) {
    out.ratesTilt = ap - 0.5;
    out.ratesPresent = true;
  }
  const m = docs.mirofish;
  if (m) {
    const stage = String(m.stage ?? "");
    const mAt = Number(m.at);
    const mp = m.probability == null ? NaN : Number(m.probability);
    if (!stage || stage.startsWith("error") || stage === "unavailable") out.mirofishState = "down";
    else if (!Number.isFinite(mAt) || mAt > now + 60_000 || now - mAt >= FRESH_MS) out.mirofishState = "stale";
    else if (!(mp >= 0 && mp <= 1)) out.mirofishState = "no_direction";
    else {
      out.mirofishState = "ok";
      out.mirofishP = mp;
    }
  }
  return out;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function readNewsDocs(root = DATA_ROOT): NewsDocs {
  return { spark: readJson(`${root}/spark-latest.json`), alexandria: readJson(`${root}/alexandria-latest.json`), mirofish: readJson(`${root}/mirofish-latest.json`) };
}

let calCache: { at: number; times: number[] } = { at: -Infinity, times: [] };
/** Tier-1 release times from data/macro-calendar.json, re-read at most every 10 minutes. */
export function releaseTimes(root = DATA_ROOT, now = Date.now()): number[] {
  if (now - calCache.at < 600_000) return calCache.times;
  const j = readJson(`${root}/macro-calendar.json`);
  const ev = Array.isArray(j?.events) ? (j!.events as Release[]) : [];
  calCache = { at: now, times: tier1(ev) };
  return calCache.times;
}
