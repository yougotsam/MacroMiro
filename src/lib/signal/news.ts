/**
 * News and fundamentals as numbers the score can weigh. Nothing here fetches, calls a model, or reads free text
 * into a decision: it parses the snapshot files the research workers already write (Spark card, Alexandria,
 * MiroFish, the official release calendar) into bounded numbers. A missing or stale file gives 0 and
 * `present: false`; it never sits a ticket by itself and never invents a MiroFish percent.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
  /** finished MiroFish scenario jobs (data/research/jobs); optional */
  research?: ResearchJob[];
};

export type ResearchJob = { stage?: string; spec?: { scenario?: string; catalyst?: { when?: string | null } }; result?: { extracted?: Record<string, unknown> } };

/** Headline tone points (GDELT average tone, roughly −10..+10). */
export type ToneSeries = { t: number; tone: number }[];

/** Tone z-score at `t`: mean of the last 6h vs the 7 days before, using only points at least 30 min old. */
export function toneZAt(tone: ToneSeries, t: number): number | null {
  const cut = t - 30 * 60_000;
  let lo = 0, hi = tone.length - 1, last = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (tone[m].t <= cut) { last = m; lo = m + 1; } else hi = m - 1; }
  let s6 = 0, n6 = 0, s = 0, ss = 0, n = 0;
  for (let k = last; k >= 0; k--) {
    const p = tone[k];
    if (p.t < cut - 7 * 86_400_000) break;
    s += p.tone; ss += p.tone * p.tone; n++;
    if (p.t >= cut - 6 * 3_600_000) { s6 += p.tone; n6++; }
  }
  if (n < 50 || n6 < 3) return null;
  const m = s / n, sd = Math.sqrt(Math.max(1e-9, ss / n - m * m));
  return (s6 / n6 - m) / sd;
}

const ASSET_WORDS: Record<Asset, RegExp> = {
  BTC: /\b(bitcoin|btc)\b/i, ETH: /\b(ethereum|eth|ether)\b/i, SOL: /\b(solana|sol)\b/i, XRP: /\b(xrp|ripple)\b/i, GOLD: /\b(gold|xau|bullion)\b/i,
};
const UP = /\b(rall(y|ies|ied)|surge[sd]?|gain(s|ed)?|bid|inflows?|bullish|upside|higher|rebound(s|ed)?|accumulat\w*|safe[- ]haven demand|outperform\w*|captures? (protective )?(capital )?flows?|expansion)\b/gi;
const DOWN = /\b(sell-?off|liquidat\w*|declin\w*|drop(s|ped)?|fall(s|ing)?|bearish|downside|lower|outflows?|de-?risk\w*|exits?|cannibaliz\w*|vacuum|fragil\w*|pressure|underperform\w*|slippage)\b/gi;

/**
 * Scenario-to-direction: reads a finished MiroFish scenario report (its extracted fields) and scores, for one asset,
 * the up-words minus down-words in sentences that name that asset, as −1..+1. Null when no sentence names the
 * asset. This is a direction, not a probability; it is never shown or used as a percent.
 */
export function scenarioDirection(extracted: Record<string, unknown> | undefined, asset: Asset): number | null {
  if (!extracted) return null;
  const text = Object.values(extracted).filter((v) => typeof v === "string").join(" ");
  let up = 0, down = 0;
  for (const sent of text.split(/(?<=[.!?])\s+/)) {
    if (!ASSET_WORDS[asset].test(sent)) continue;
    up += sent.match(UP)?.length ?? 0;
    down += sent.match(DOWN)?.length ?? 0;
  }
  return up + down === 0 ? null : (up - down) / (up + down);
}

export type NewsRead = {
  /** −1 bearish .. +1 bullish for this asset, from a fresh Spark card. 0 if none. */
  sparkBias: number;
  sparkPresent: boolean;
  /** Alexandria / rates probability centred at 0 (−0.5..+0.5), only for rate-sensitive assets. */
  ratesTilt: number;
  ratesPresent: boolean;
  /** MiroFish swarm probability of "up", or null when it is down, stale, or gave none. Never invented. */
  mirofishP: number | null;
  /** −1..+1 from the newest finished BASELINE scenario run for a release within the last 24h / next 48h; null if none */
  mirofishDir: number | null;
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
  const out: NewsRead = { sparkBias: 0, sparkPresent: false, ratesTilt: 0, ratesPresent: false, mirofishP: null, mirofishDir: null, mirofishState: "missing" };
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
  if (out.mirofishP == null && out.mirofishState !== "down" && docs.research?.length) {
    const near = docs.research
      .filter((j) => j.stage === "done" && j.spec?.scenario === "baseline")
      .map((j) => ({ j, at: Date.parse(String(j.spec?.catalyst?.when ?? "")) }))
      .filter(({ at }) => Number.isFinite(at) && at - now <= 48 * 3_600_000 && now - at <= 24 * 3_600_000)
      .sort((a, b) => b.at - a.at)[0];
    const d = near ? scenarioDirection(near.j.result?.extracted, asset) : null;
    if (d != null) out.mirofishDir = d;
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

export function readResearchJobs(dir: string): ResearchJob[] {
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => readJson(`${dir}/${f}`) as ResearchJob | null).filter((j): j is ResearchJob => !!j);
  } catch {
    return [];
  }
}

export function readNewsDocs(root = DATA_ROOT): NewsDocs {
  return { spark: readJson(`${root}/spark-latest.json`), alexandria: readJson(`${root}/alexandria-latest.json`), mirofish: readJson(`${root}/mirofish-latest.json`), research: readResearchJobs(`${root}/research/jobs`) };
}

/** Tone file written by scripts/signal-fetch-extra.ts (data/signal/news/tone-<ASSET|MACRO>.jsonl). */
export function readTone(dir: string, key: Asset | "MACRO"): ToneSeries {
  const f = `${dir}/news/tone-${key}.jsonl`;
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { t: number; tone: number });
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
