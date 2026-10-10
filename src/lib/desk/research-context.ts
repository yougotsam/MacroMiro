/**
 * MiroFish / Firecrawl / Spark2 / Alexandria / desk-news as SOURCED, TIMESTAMPED research and macro context.
 * Context only: items carry who said it, where, and when — never a probability. Any `probability` field a source
 * emits is dropped here. Nothing on the order path (settlement model, gate, approval, risk, OMS, evaluator) may import
 * this module or the live/intel pipelines; research-context.test.ts walks the import graph to enforce it.
 * The only external input that can affect the order path is the scheduled macro calendar (macro-calendar.ts), and it
 * can only BLOCK entries.
 */
import { readFileSync, statSync } from "node:fs";
import { DATA_ROOT } from "@/lib/data-root";

export type ResearchSource = "mirofish" | "firecrawl" | "spark2" | "alexandria" | "desk_news";
export type ResearchItem = Readonly<{
  source: ResearchSource;
  kind: "research" | "macro_context" | "status";
  title: string;
  detail: string | null;
  url: string | null;
  /** when the source says the item was produced/published (ISO), if it says */
  publishedAt: string | null;
  /** when our pipeline retrieved it (ISO) — required: undated items are dropped */
  retrievedAt: string;
  file: string;
}>;
export type ResearchContext = Readonly<{ role: "context_only"; builtAt: string; items: readonly ResearchItem[]; dropped: number }>;

const iso = (x: unknown): string | null => {
  const t = typeof x === "number" ? x : Date.parse(String(x ?? ""));
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null;
};
const str = (x: unknown, n = 280) => (typeof x === "string" && x.trim() ? x.trim().slice(0, n) : null);
const url = (x: unknown) => (typeof x === "string" && /^https?:\/\//.test(x) ? x.slice(0, 400) : null);

function readJson(path: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Pure: build the context from raw source documents (unit-tested). Probabilities are never copied. */
export function buildResearchContext(raw: Partial<Record<"mirofish" | "spark" | "alexandria" | "news", Record<string, unknown> | null>> & { firecrawlSeedMtimeMs?: number | null }, now = Date.now()): ResearchContext {
  const items: ResearchItem[] = [];
  let dropped = 0;
  const push = (x: Omit<ResearchItem, "retrievedAt"> & { retrievedAt: string | null }) => {
    if (!x.retrievedAt || !x.title) {
      dropped += 1;
      return;
    }
    items.push(Object.freeze({ ...x, retrievedAt: x.retrievedAt }) as ResearchItem);
  };
  const m = raw.mirofish;
  if (m) push({ source: "mirofish", kind: "research", title: str(m.headline) ?? "", detail: str(m.stage), url: null, publishedAt: null, retrievedAt: iso(m.at), file: "mirofish-latest.json" });
  const s = raw.spark;
  if (s) {
    const card = (s.card ?? {}) as Record<string, unknown>;
    push({ source: "spark2", kind: "macro_context", title: str(card.event) ?? "", detail: str(card.why), url: null, publishedAt: null, retrievedAt: iso(s.at), file: "spark-latest.json" });
    for (const h of Array.isArray(card.headlines) ? (card.headlines as Record<string, unknown>[]) : []) {
      push({ source: "spark2", kind: "research", title: str(h.title ?? h.headline) ?? "", detail: str(h.source), url: url(h.url ?? h.link), publishedAt: iso(h.published ?? h.date ?? h.at), retrievedAt: iso(s.at), file: "spark-latest.json" });
    }
  }
  const a = raw.alexandria;
  if (a) for (const t of Array.isArray(a.tools) ? (a.tools as Record<string, unknown>[]) : []) {
    push({ source: "alexandria", kind: "research", title: str(t.name ?? t.title) ?? "", detail: str(t.description ?? t.summary), url: url(t.url), publishedAt: null, retrievedAt: iso(a.at), file: "alexandria-latest.json" });
  }
  const n = raw.news;
  if (n) {
    for (const h of Array.isArray(n.headlines) ? (n.headlines as Record<string, unknown>[]) : []) {
      push({ source: "desk_news", kind: "macro_context", title: str(h.title ?? h.headline) ?? "", detail: str(h.source ?? h.provider), url: url(h.url ?? h.link), publishedAt: iso(h.published ?? h.date ?? h.at ?? h.time), retrievedAt: iso(n.at), file: "desk-news.json" });
    }
  }
  if (raw.firecrawlSeedMtimeMs != null) push({ source: "firecrawl", kind: "status", title: "MiroFish seed document scraped", detail: null, url: null, publishedAt: null, retrievedAt: iso(raw.firecrawlSeedMtimeMs), file: "mirofish-seed.md" });
  return Object.freeze({ role: "context_only", builtAt: new Date(now).toISOString(), items: Object.freeze(items), dropped });
}

export function readResearchContext(now = Date.now()): ResearchContext {
  const miroDir = process.env.MIROFISH_DATA_DIR || DATA_ROOT;
  let seed: number | null = null;
  try {
    seed = statSync(`${miroDir}/mirofish-seed.md`).mtimeMs;
  } catch {
    seed = null;
  }
  return buildResearchContext({
    mirofish: readJson(`${miroDir}/mirofish-latest.json`),
    spark: readJson(`${DATA_ROOT}/spark-latest.json`),
    alexandria: readJson(`${DATA_ROOT}/alexandria-latest.json`),
    news: readJson(`${DATA_ROOT}/desk-news.json`),
    firecrawlSeedMtimeMs: seed,
  }, now);
}
