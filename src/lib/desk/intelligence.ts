/**
 * Read-only intelligence bridge. The existing Spark/Firecrawl → MiroFish and Alexandria
 * workflows are preserved; their narrative/probability outputs are NOT calibrated
 * Kalshi settlement forecasts and must never adjust pYES directly.
 */
import { readFileSync, statSync } from "node:fs";
import { DATA_ROOT } from "@/lib/data-root";

type Scheduled = { name?: string; when?: string };
export type DeskIntelligence = {
  mirofish: { stage: string; ageMs: number | null; probability: number | null; usableForSettlement: false };
  spark: { status: string; at: string | null; fresh: boolean };
  alexandria: { tools: number };
  firecrawl: { lastDocumentAgeMs: number | null; ready: boolean };
  macroVeto: boolean;
  vetoEvents: string[];
  /** No LLM-derived model confidence is returned for order submission. */
};
const MAJOR = /\b(CPI|consumer price|FOMC|Federal Reserve rate|nonfarm|NFP|employment situation|PPI|producer price)\b/i;

/** Date.parse accepts many ambiguous formats; require explicit timezone for a trading veto. */
function eventMs(raw: string): number | null {
  if (!/\d{4}-\d{2}-\d{2}T\d\d:\d\d.*(?:Z|[+-]\d\d:\d\d)$/.test(raw)) return null;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? at : null;
}
export function scheduledVeto(events: Scheduled[], now: number): string[] {
  return events.filter((e) => {
    const ts = eventMs(e.when ?? "");
    return ts != null && MAJOR.test(e.name ?? "") && ts - 30 * 60_000 <= now && now <= ts + 15 * 60_000;
  }).map((e) => `${e.name}: ${e.when}`);
}

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
    macroVeto: vetoEvents.length > 0, vetoEvents
  };
}
