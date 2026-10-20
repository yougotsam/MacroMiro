/**
 * Firecrawl Spark brief, Alexandria catalog, MiroFish last run, and the desk news calendar.
 * Read from the files those pipelines already write. No network call. A model percent is not the
 * settlement chance. A fresh read is written on the reason. It does not cancel the ticket.
 */
import { readFileSync } from "node:fs";
import { DATA_ROOT } from "@/lib/data-root";
import type { Series } from "./config";
import { scheduledVeto, type Scheduled } from "./macro-calendar";

const FRESH_MS = 6 * 3600_000;

export type IntelDocs = {
  spark: Record<string, unknown> | null;
  alexandria: Record<string, unknown> | null;
  news: Record<string, unknown> | null;
  mirofish: Record<string, unknown> | null;
};

export type IntelVerdict = {
  ok: boolean;
  why: string;
  sparkBias: string | null;
  sparkAsset: string | null;
  mirofish: string;
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
  const done = (ok: boolean, why: string, sparkBias: string | null, sparkAsset: string | null): IntelVerdict => {
    if (fish.side && fish.side !== side) {
      return { ok: true, why: `${why}+mirofish_noted`, sparkBias, sparkAsset, mirofish: fish.state };
    }
    return { ok, why, sparkBias, sparkAsset, mirofish: fish.state };
  };

  const cal = docs.news?.calendar as { thisWeek?: Scheduled[]; nextWeek?: Scheduled[] } | undefined;
  const veto = scheduledVeto([...(cal?.thisWeek ?? []), ...(cal?.nextWeek ?? [])], now);
  if (veto.length) return done(true, "news_release_noted", null, null);

  const spark = docs.spark;
  const at = Date.parse(String(spark?.at ?? ""));
  const card = spark?.card as { bias?: string; asset?: string } | null | undefined;
  const fresh = spark?.status === "completed" && card && Number.isFinite(at) && now >= at && now - at < FRESH_MS;
  if (!fresh) return done(true, "spark_stale", null, null);

  const bias = String(card.bias ?? "unclear");
  const asset = String(card.asset ?? "unclear");
  if (bias !== "bullish" && bias !== "bearish") return done(true, "spark_unclear", bias, asset);
  if (!covers(series, asset)) return done(true, "spark_other_asset", bias, asset);
  const want = bias === "bullish" ? "yes" : "no";
  if (side !== want) return done(true, `spark_${bias}_noted`, bias, asset);
  return done(true, `spark_${bias}_agrees`, bias, asset);
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function intelVerdict(series: Series, side: "yes" | "no", now = Date.now()): IntelVerdict {
  return judgeIntel(
    series,
    side,
    {
      spark: readJson(`${DATA_ROOT}/spark-latest.json`),
      alexandria: readJson(`${DATA_ROOT}/alexandria-latest.json`),
      news: readJson(`${DATA_ROOT}/desk-news.json`),
      mirofish: readJson(`${DATA_ROOT}/mirofish-latest.json`),
    },
    now,
  );
}
