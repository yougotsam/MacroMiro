import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { buildCatalysts, type Catalyst, type RawHit } from "@/lib/live/catalyst";
import { firecrawlReady, pullOfficial } from "@/lib/live/firecrawl.server";
import { readSpark } from "@/lib/live/spark.server";
import { listInbox } from "@/lib/printgate/inbox.server";

const LATEST = "/workspace/data/catalyst-latest.json";
const LOG = "/workspace/data/catalyst.jsonl";

export type RadarFile = {
  live: boolean;
  crawledAt: string | null;
  crawlMs: number | null;
  errors: string[];
  spark: string;
  items: Catalyst[];
  note: "news cannot trade";
};

function empty(): RadarFile {
  return { live: firecrawlReady(), crawledAt: null, crawlMs: null, errors: [], spark: "not run", items: [], note: "news cannot trade" };
}

export function readRadar(): RadarFile {
  try {
    const parsed = JSON.parse(readFileSync(LATEST, "utf8")) as RadarFile;
    return { ...parsed, live: firecrawlReady(), note: "news cannot trade" };
  } catch {
    return empty();
  }
}

function hitsFromInbox(): RawHit[] {
  return listInbox().map((e) => ({
    title: e.judgment || e.eventClass || e.type,
    url: e.url || "",
    at: e.receivedAt,
    kind: e.eventClass,
  }));
}

export function radarFromInbox(crawledAt: string): Catalyst[] {
  return buildCatalysts(hitsFromInbox(), crawledAt);
}

export async function refreshRadar(): Promise<RadarFile> {
  const started = Date.now();
  const pull = await pullOfficial();
  const crawledAt = new Date().toISOString();
  const items = radarFromInbox(crawledAt);
  const file: RadarFile = {
    live: pull.live,
    crawledAt,
    crawlMs: Date.now() - started,
    errors: pull.errors,
    spark: "not run",
    items,
    note: "news cannot trade",
  };
  const spark = readSpark();
  file.spark = spark?.status ? `spark ${spark.status}` : "not run";
  mkdirSync("/workspace/data", { recursive: true });
  writeFileSync(LATEST, JSON.stringify(file));
  appendFileSync(LOG, `${JSON.stringify({ at: crawledAt, n: items.length, ms: file.crawlMs, errors: pull.errors.length })}\n`);
  return file;
}
