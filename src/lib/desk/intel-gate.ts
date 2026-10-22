/**
 * Firecrawl Spark brief, Alexandria catalog, MiroFish last run, and the desk news calendar.
 * Read from the files those pipelines already write. No network call. A model percent is not the
 * settlement chance. A fresh read is written on the reason. It does not cancel the ticket.
 */
import { appendFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { DATA_ROOT } from "@/lib/data-root";
import type { Series } from "./config";
import { scheduledVeto, type Scheduled } from "./macro-calendar";

const FRESH_MS = 6 * 3600_000;

export type IntelDocs = {
  spark: Record<string, unknown> | null;
  alexandria: Record<string, unknown> | null;
  news: Record<string, unknown> | null;
  mirofish: Record<string, unknown> | null;
  firecrawlReady?: boolean;
  controls?: { spark: boolean; alexandria: boolean; firecrawl: boolean };
};

export type IntelVerdict = {
  ok: boolean;
  why: string;
  sparkBias: string | null;
  sparkAsset: string | null;
  mirofish: string;
  /** Signed log-odds added to the settlement chance. Positive means YES. */
  logit: number;
};

function covers(series: Series, asset: string): boolean {
  if (asset === "both") return series === "KXBTC15M" || series === "KXGOLD15M";
  if (asset === "btc") return series === "KXBTC15M";
  if (asset === "gold") return series === "KXGOLD15M";
  return false;
}

function miroRead(m: Record<string, unknown> | null, now: number): { state: string; side: "yes" | "no" | null } {
  if (!m) return { state: "missing", side: null };
  const stage = String(m.stage ?? "");
  if (!stage || stage.startsWith("error") || stage === "unavailable") return { state: "down", side: null };
  const at = Number(m.at);
  if (!Number.isFinite(at) || at > now + 60_000 || now - at >= FRESH_MS) return { state: "stale", side: null };
  const p = Number(m.probability);
  if (!Number.isFinite(p) || p < 0 || p > 1) return { state: "no_direction", side: null };
  if (p >= 0.55) return { state: "bullish", side: "yes" };
  if (p <= 0.45) return { state: "bearish", side: "no" };
  return { state: "flat", side: null };
}

/** Pure. `now` is the clock. Spark `at` is an ISO time. MiroFish `at` is epoch milliseconds. */
export function judgeIntel(series: Series, side: "yes" | "no", docs: IntelDocs, now: number): IntelVerdict {
  const fish = miroRead(docs.mirofish, now);
  const done = (ok: boolean, why: string, sparkBias: string | null, sparkAsset: string | null, logit: number): IntelVerdict => {
    if (fish.side && fish.side !== side) {
      return { ok: true, why: `${why}+mirofish_noted`, sparkBias, sparkAsset, mirofish: fish.state, logit };
    }
    return { ok, why, sparkBias, sparkAsset, mirofish: fish.state, logit };
  };

  const cal = docs.news?.calendar as { thisWeek?: Scheduled[]; nextWeek?: Scheduled[] } | undefined;
  const veto = scheduledVeto([...(cal?.thisWeek ?? []), ...(cal?.nextWeek ?? [])], now);
  const sparkL = sparkLogit(series, docs, now);
  if (veto.length) return done(true, "news_release_noted", null, null, sparkL);

  const spark = docs.spark;
  const at = Date.parse(String(spark?.at ?? ""));
  const card = spark?.card as { bias?: string; asset?: string } | null | undefined;
  const fresh = spark?.status === "completed" && card && Number.isFinite(at) && now >= at && now - at < FRESH_MS;
  if (!fresh) return done(true, "spark_stale", null, null, sparkL);

  const bias = String(card.bias ?? "unclear");
  const asset = String(card.asset ?? "unclear");
  if (bias !== "bullish" && bias !== "bearish") return done(true, "spark_unclear", bias, asset, sparkL);
  if (!covers(series, asset)) return done(true, "spark_other_asset", bias, asset, sparkL);
  const want = bias === "bullish" ? "yes" : "no";
  if (side !== want) return done(true, `spark_${bias}_noted`, bias, asset, sparkL);
  return done(true, `spark_${bias}_agrees`, bias, asset, sparkL);
}

/** Spark, Alexandria, and a fresh Firecrawl seed move the chance. A missing file adds nothing. */
export function sparkLogit(series: Series, docs: IntelDocs, now: number): number {
  let sparkL = 0;
  const spark = docs.spark;
  const at = Date.parse(String(spark?.at ?? ""));
  const card = spark?.card as { bias?: string; asset?: string } | null | undefined;
  const fresh = spark?.status === "completed" && card && Number.isFinite(at) && now >= at && now - at < FRESH_MS;
  if (docs.controls?.spark !== false && fresh && covers(series, String(card?.asset ?? ""))) {
    if (card?.bias === "bullish") sparkL += 0.25;
    if (card?.bias === "bearish") sparkL -= 0.25;
  }
  let alexL = 0;
  const alex = docs.alexandria;
  const alexAt = Date.parse(String(alex?.at ?? ""));
  const alexFresh = docs.controls?.alexandria !== false && Number.isFinite(alexAt) && now >= alexAt && now - alexAt < 7 * 24 * 3600_000;
  const p = Number(alex?.probability);
  if (alexFresh && p >= 0 && p <= 1) alexL = Math.max(-0.25, Math.min(0.25, (p - 0.5) * 0.8));
  let L = sparkL + alexL;
  if (docs.controls?.firecrawl !== false && docs.firecrawlReady === true && L !== 0) L *= 1.25;
  return L;
}

const CONTROL_FILE = () => `${DATA_ROOT}/desk/intel-controls.json`;

export function readIntelControls(): { spark: boolean; alexandria: boolean; firecrawl: boolean } {
  const row = readJson(CONTROL_FILE());
  return {
    spark: row?.spark !== false,
    alexandria: row?.alexandria !== false,
    firecrawl: row?.firecrawl !== false,
  };
}

export function writeIntelControls(next: Partial<{ spark: boolean; alexandria: boolean; firecrawl: boolean }>) {
  const cur = readIntelControls();
  const row = { ...cur, ...next, at: new Date().toISOString() };
  mkdirSync(`${DATA_ROOT}/desk`, { recursive: true });
  writeFileSync(CONTROL_FILE(), JSON.stringify(row));
  return row;
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function readIntelLogit(series: Series, now = Date.now()): number {
  let firecrawlReady = false;
  try {
    const age = now - statSync(`${DATA_ROOT}/mirofish-seed.md`).mtimeMs;
    firecrawlReady = age >= 0 && age < 24 * 3600_000;
  } catch { /* seed not on disk */ }
  return sparkLogit(series, {
    spark: readJson(`${DATA_ROOT}/spark-latest.json`),
    alexandria: readJson(`${DATA_ROOT}/alexandria-latest.json`),
    news: readJson(`${DATA_ROOT}/desk-news.json`),
    mirofish: readJson(`${DATA_ROOT}/mirofish-latest.json`),
    firecrawlReady,
    controls: readIntelControls(),
  }, now);
}

export function intelVerdict(series: Series, side: "yes" | "no", now = Date.now()): IntelVerdict {
  let firecrawlReady = false;
  try {
    const age = now - statSync(`${DATA_ROOT}/mirofish-seed.md`).mtimeMs;
    firecrawlReady = age >= 0 && age < 24 * 3600_000;
  } catch { /* seed not on disk */ }
  return judgeIntel(
    series,
    side,
    {
      spark: readJson(`${DATA_ROOT}/spark-latest.json`),
      alexandria: readJson(`${DATA_ROOT}/alexandria-latest.json`),
      news: readJson(`${DATA_ROOT}/desk-news.json`),
      mirofish: readJson(`${DATA_ROOT}/mirofish-latest.json`),
      firecrawlReady,
      controls: readIntelControls(),
    },
    now,
  );
}

export type IntelRun = {
  ts: string;
  series: string;
  side: "yes" | "no";
  passed_gate: true;
  logit: number;
  controls: { spark: boolean; alexandria: boolean; firecrawl: boolean };
  requested: string[];
};

let lastIntelKick = 0;

/** Called only after the price gate has a ticket. Spark, Alexandria, and Firecrawl run from here. Does not wait. A second pass inside 10 minutes does not start another paid job. */
export function onGatePass(series: Series, side: "yes" | "no", now = Date.now()): IntelRun {
  const controls = { spark: true, alexandria: true, firecrawl: true };
  const requested: string[] = [];
  if (now - lastIntelKick >= 10 * 60_000) {
    requested.push("spark", "alexandria", "firecrawl");
    lastIntelKick = now;
    void import("@/lib/live/spark.server").then((m) => m.kickSparkOnPass()).catch(() => undefined);
    void import("@/lib/live/firecrawl.server")
      .then((m) => m.searchNews(`${series} macro`, 5).catch(() => undefined))
      .catch(() => undefined);
  }
  const row: IntelRun = {
    ts: new Date(now).toISOString(),
    series,
    side,
    passed_gate: true,
    logit: readIntelLogit(series, now),
    controls,
    requested,
  };
  try {
    mkdirSync(`${DATA_ROOT}/desk`, { recursive: true });
    appendFileSync(`${DATA_ROOT}/desk/intel-audit.jsonl`, `${JSON.stringify(row)}\n`);
  } catch { /* the decision row still carries the same fields */ }
  return row;
}
