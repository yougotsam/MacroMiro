/**
 * Firecrawl Spark brief + Alexandria catalog + the desk news calendar, read from the files those
 * pipelines already write. This module does not call the network and does not turn a model percent
 * into a settlement chance. A fresh Spark bias can only agree or refuse the side already chosen.
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
};

export type IntelVerdict = {
  ok: boolean;
  why: string;
  sparkBias: string | null;
  sparkAsset: string | null;
};

function covers(series: Series, asset: string): boolean {
  if (asset === "both") return series === "KXBTC15M" || series === "KXGOLD15M";
  if (asset === "btc") return series === "KXBTC15M";
  if (asset === "gold") return series === "KXGOLD15M";
  return false;
}

/** Pure. `now` is the clock. Spark `at` is an ISO time. */
export function judgeIntel(series: Series, side: "yes" | "no", docs: IntelDocs, now: number): IntelVerdict {
  const tools = Array.isArray(docs.alexandria?.tools) ? docs.alexandria.tools : [];
  if (tools.length === 0) return { ok: false, why: "alexandria_not_loaded", sparkBias: null, sparkAsset: null };

  const cal = docs.news?.calendar as { thisWeek?: Scheduled[]; nextWeek?: Scheduled[] } | undefined;
  const veto = scheduledVeto([...(cal?.thisWeek ?? []), ...(cal?.nextWeek ?? [])], now);
  if (veto.length) return { ok: false, why: "news_release_window", sparkBias: null, sparkAsset: null };

  const spark = docs.spark;
  const at = Date.parse(String(spark?.at ?? ""));
  const card = spark?.card as { bias?: string; asset?: string } | null | undefined;
  const fresh = spark?.status === "completed" && card && Number.isFinite(at) && now >= at && now - at < FRESH_MS;
  if (!fresh) return { ok: false, why: "spark_not_ready", sparkBias: null, sparkAsset: null };

  const bias = String(card.bias ?? "unclear");
  const asset = String(card.asset ?? "unclear");
  if (bias !== "bullish" && bias !== "bearish") return { ok: true, why: "spark_unclear", sparkBias: bias, sparkAsset: asset };
  if (!covers(series, asset)) return { ok: true, why: "spark_other_asset", sparkBias: bias, sparkAsset: asset };
  const want = bias === "bullish" ? "yes" : "no";
  if (side !== want) return { ok: false, why: `spark_${bias}_opposes_${side}`, sparkBias: bias, sparkAsset: asset };
  return { ok: true, why: `spark_${bias}_agrees`, sparkBias: bias, sparkAsset: asset };
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
    },
    now,
  );
}
