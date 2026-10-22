/**
 * Read-only file load. Spark, Alexandria, and Firecrawl change the chance through
 * `intelligenceLogit`, which the evaluator adds before the price is judged.
 * Spark and Alexandria jobs start only after a ticket clears the gate (`onGatePass`).
 * This file does not send.
 */
import { readFileSync, statSync } from "node:fs";
import { DATA_ROOT } from "@/lib/data-root";

import { scheduledVeto, type Scheduled } from "./macro-calendar";
import { readIntelControls, readIntelLogit } from "./intel-gate";
import type { Series } from "./config";

export { scheduledVeto, readIntelControls };
export function intelligenceLogit(series: Series, now = Date.now()): number {
  return readIntelLogit(series, now);
}
export type DeskIntelligence = {
  mirofish: { stage: string; ageMs: number | null; probability: number | null; usableForSettlement: false };
  spark: { status: string; at: string | null; fresh: boolean };
  alexandria: { tools: number };
  firecrawl: { lastDocumentAgeMs: number | null; ready: boolean };
  macroVeto: boolean;
  vetoEvents: string[];
  controls: { spark: boolean; alexandria: boolean; firecrawl: boolean };
  /** No LLM-derived model confidence is returned for order submission. */
};

function readJson(path: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}
export function readDeskIntelligence(now = Date.now()): DeskIntelligence {
  const miroDir = process.env.MIROFISH_DATA_DIR || DATA_ROOT;
  const miro = readJson(`${miroDir}/mirofish-latest.json`);
  const spark = readJson(`${DATA_ROOT}/spark-latest.json`);
  const alex = readJson(`${DATA_ROOT}/alexandria-latest.json`);
  const news = readJson(`${DATA_ROOT}/desk-news.json`);
  const calendar = news?.calendar as { thisWeek?: Scheduled[]; nextWeek?: Scheduled[] } | undefined;
  const events = [...(calendar?.thisWeek ?? []), ...(calendar?.nextWeek ?? [])];
  const vetoEvents = scheduledVeto(events, now);
  const miroAt = Number(miro?.at);
  const sparkAt = Date.parse(String(spark?.at ?? ""));
  let firecrawlAge: number | null = null;
  try { firecrawlAge = now - statSync(`${miroDir}/mirofish-seed.md`).mtimeMs; } catch { /* not yet seeded */ }
  const miroProbability = Number(miro?.probability);
  return {
    mirofish: { stage: typeof miro?.stage === "string" ? miro.stage : "unavailable",
      ageMs: miro && Number.isFinite(miroAt) ? now - miroAt : null,
      probability: miro?.probability != null && Number.isFinite(miroProbability) && miroProbability >= 0 &&
        miroProbability <= 1 ? miroProbability : null, usableForSettlement: false },
    spark: { status: String(spark?.status ?? "unavailable"), at: typeof spark?.at === "string" ? spark.at : null,
      fresh: Number.isFinite(sparkAt) && now >= sparkAt && now - sparkAt < 6 * 3600_000 },
    alexandria: { tools: Array.isArray(alex?.tools) ? alex.tools.length : 0 },
    firecrawl: { lastDocumentAgeMs: firecrawlAge,
      ready: firecrawlAge != null && firecrawlAge >= 0 && firecrawlAge < 24 * 3600_000 },
    macroVeto: vetoEvents.length > 0,
    vetoEvents,
    controls: readIntelControls(),
  };
}
