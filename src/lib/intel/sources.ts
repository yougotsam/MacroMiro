/**
 * Source registry, schedule, de-duplication and Firecrawl credit budget for the research pipeline.
 *
 * RESEARCH ONLY. Nothing in this file can place, size, approve or block an order, and nothing here produces a
 * probability. Web content is untrusted data: it is hashed, timestamped and labelled, never executed or obeyed.
 * The single source of truth for humans is docs/FIRECRAWL_SOURCE_REGISTRY.md; keep the two in step.
 */
import { createHash } from "node:crypto";

export type Method = "firecrawl-scrape" | "firecrawl-search" | "firecrawl-agent" | "firecrawl-monitor" | "direct-api" | "rss" | "ical" | "direct-html";
export type Status = "VERIFIED" | "BROKEN" | "PLANNED" | "UNUSED" | "DUPLICATE";
/** event = only around scheduled releases (calendar-driven); the others are fixed cadences. */
export type Cadence = "event" | "1-3h" | "6-8h" | "daily" | "on-demand";

export type Source = {
  id: string;
  site: string;
  url: string;
  topic: string;
  method: Method;
  status: Status;
  cadence: Cadence;
  /** Minimum minutes between checks when nothing is scheduled. */
  everyMin: number;
  /** Firecrawl credits per check (0 for direct/RSS/iCal). */
  creditsPerCheck: number;
  /** Essential sources keep running when the monthly credit ceiling is hit; nonessential ones are suspended. */
  essential: boolean;
  /** Content older than this is treated as stale and not passed on as "news". */
  freshHours: number;
  destination: string;
};

const H = 60;
export const SOURCES: Source[] = [
  { id: "bls_ical", site: "BLS release calendar", url: "https://www.bls.gov/schedule/news_release/bls.ics", topic: "CPI/NFP/PPI release times", method: "ical", status: "VERIFIED", cadence: "6-8h", everyMin: 6 * H, creditsPerCheck: 0, essential: true, freshHours: 7 * 24, destination: "macro-calendar → trading news gate" },
  { id: "bea_ical", site: "BEA release calendar", url: "https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics", topic: "GDP/PCE release times", method: "ical", status: "VERIFIED", cadence: "6-8h", everyMin: 6 * H, creditsPerCheck: 0, essential: true, freshHours: 7 * 24, destination: "macro-calendar → trading news gate" },
  { id: "fed_fomc", site: "Federal Reserve FOMC calendar", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm", topic: "FOMC meeting dates", method: "direct-html", status: "VERIFIED", cadence: "6-8h", everyMin: 6 * H, creditsPerCheck: 0, essential: true, freshHours: 7 * 24, destination: "macro-calendar → trading news gate" },
  { id: "fed_rss", site: "Federal Reserve press RSS", url: "https://www.federalreserve.gov/feeds/press_all.xml", topic: "Fed statements, speeches", method: "rss", status: "VERIFIED", cadence: "1-3h", everyMin: 60, creditsPerCheck: 0, essential: true, freshHours: 24, destination: "news panel → Spark2 seed" },
  { id: "sec_rss", site: "SEC press releases RSS", url: "https://www.sec.gov/news/pressreleases.rss", topic: "Crypto/ETF regulation", method: "rss", status: "VERIFIED", cadence: "1-3h", everyMin: 2 * H, creditsPerCheck: 0, essential: false, freshHours: 48, destination: "news panel → Spark2 seed" },
  { id: "cftc_rss", site: "CFTC general press RSS", url: "https://www.cftc.gov/RSS/RSSGP/rssgp.xml", topic: "Derivatives/crypto regulation", method: "rss", status: "VERIFIED", cadence: "6-8h", everyMin: 6 * H, creditsPerCheck: 0, essential: false, freshHours: 72, destination: "news panel" },
  { id: "coindesk_rss", site: "CoinDesk RSS", url: "https://www.coindesk.com/arc/outboundfeeds/rss", topic: "Crypto news", method: "rss", status: "VERIFIED", cadence: "1-3h", everyMin: 60, creditsPerCheck: 0, essential: false, freshHours: 24, destination: "news panel → MiroFish seed candidates" },
  { id: "cnbc_rss", site: "CNBC markets RSS", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", topic: "Macro/market news", method: "rss", status: "VERIFIED", cadence: "1-3h", everyMin: 2 * H, creditsPerCheck: 0, essential: false, freshHours: 24, destination: "news panel" },
  { id: "gnews_rss", site: "Google News RSS (query)", url: "https://news.google.com/rss/search?q=Federal+Reserve+OR+FOMC+OR+CPI+OR+bitcoin+OR+gold", topic: "Aggregated headlines", method: "rss", status: "VERIFIED", cadence: "1-3h", everyMin: 2 * H, creditsPerCheck: 0, essential: false, freshHours: 24, destination: "news panel" },
  { id: "ff_xml", site: "Forex Factory weekly XML", url: "https://nfs.faireconomy.media/ff_calendar_thisweek.xml", topic: "Consensus forecasts", method: "direct-api", status: "VERIFIED", cadence: "6-8h", everyMin: 6 * H, creditsPerCheck: 0, essential: false, freshHours: 7 * 24, destination: "news-kill / skill news read" },
  { id: "biquote", site: "biquote calendar API", url: "https://biquote.io/api/calendar", topic: "Consensus/actuals", method: "direct-api", status: "VERIFIED", cadence: "6-8h", everyMin: 6 * H, creditsPerCheck: 0, essential: false, freshHours: 7 * 24, destination: "news-kill" },
  { id: "fc_bls_release", site: "BLS CPI/NFP release text", url: "https://www.bls.gov/news.release/cpi.nr0.htm", topic: "Actual CPI print at release", method: "firecrawl-scrape", status: "VERIFIED", cadence: "event", everyMin: 0, creditsPerCheck: 1, essential: true, freshHours: 2, destination: "MiroFish seed → Alexandria (post-event check)" },
  { id: "fc_monitor_cpi_fomc", site: "Firecrawl monitor: BLS CPI + Fed FOMC schedule", url: "https://www.bls.gov/schedule/news_release/cpi.htm", topic: "Schedule change detection", method: "firecrawl-monitor", status: "VERIFIED", cadence: "6-8h", everyMin: 6 * H, creditsPerCheck: 2, essential: false, freshHours: 7 * 24, destination: "Firecrawl dashboard only (no webhook)" },
  { id: "fc_monitor_cpi_dup", site: "Firecrawl monitor: BLS CPI only (second copy)", url: "https://www.bls.gov/schedule/news_release/cpi.htm", topic: "Same page as above", method: "firecrawl-monitor", status: "DUPLICATE", cadence: "6-8h", everyMin: 6 * H, creditsPerCheck: 1, essential: false, freshHours: 7 * 24, destination: "nowhere (duplicate)" },
  { id: "fc_spark_brief", site: "Spark2 daily brief (14 official URLs)", url: "https://api.firecrawl.dev/v2/agent", topic: "Next scheduled catalyst + official headlines", method: "firecrawl-agent", status: "VERIFIED", cadence: "6-8h", everyMin: 6 * H, creditsPerCheck: 76, essential: false, freshHours: 6, destination: "Spark card → research context" },
  { id: "fc_clerks", site: "Intel clerks (verify/hunter/contradict/analogue)", url: "https://api.firecrawl.dev/v2/agent", topic: "Spark2 research workflows", method: "firecrawl-agent", status: "VERIFIED", cadence: "6-8h", everyMin: 6 * H, creditsPerCheck: 12, essential: false, freshHours: 6, destination: "shadow-intel.jsonl (apply:false)" },
  { id: "fc_news_search", site: "Firecrawl news search (MiroFish seeding)", url: "https://api.firecrawl.dev/v2/search", topic: "Catalyst articles", method: "firecrawl-search", status: "VERIFIED", cadence: "on-demand", everyMin: 0, creditsPerCheck: 2, essential: false, freshHours: 24, destination: "MiroFish seed" },
  { id: "fc_cme_fedwatch", site: "CME FedWatch", url: "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html", topic: "Rate-cut odds (page shell; numbers load by script)", method: "firecrawl-scrape", status: "PLANNED", cadence: "on-demand", everyMin: 0, creditsPerCheck: 1, essential: false, freshHours: 24, destination: "Spark2 URL list" },
  { id: "fc_cfb_brti", site: "CF Benchmarks BRTI page", url: "https://www.cfbenchmarks.com/data/indices/BRTI", topic: "Index methodology/reference", method: "firecrawl-scrape", status: "UNUSED", cadence: "on-demand", everyMin: 0, creditsPerCheck: 1, essential: false, freshHours: 30 * 24, destination: "reference only (settlement uses Kalshi/Coinbase feeds)" },
  { id: "fc_cftc_cot", site: "CFTC COT (CME financial)", url: "https://www.cftc.gov/dea/futures/deacmesf.htm", topic: "Weekly positioning (gold)", method: "direct-html", status: "PLANNED", cadence: "daily", everyMin: 24 * H, creditsPerCheck: 0, essential: false, freshHours: 8 * 24, destination: "python pipeline watchlist (not running)" },
  { id: "fc_eia", site: "EIA weekly petroleum", url: "https://www.eia.gov/petroleum/supply/weekly/", topic: "Oil inventories", method: "firecrawl-scrape", status: "UNUSED", cadence: "on-demand", everyMin: 0, creditsPerCheck: 1, essential: false, freshHours: 8 * 24, destination: "none (oil not a supported market)" },
  { id: "exch_status", site: "Coinbase + Kraken status RSS", url: "https://status.coinbase.com/history.rss", topic: "Exchange incidents/outages", method: "rss", status: "PLANNED", cadence: "1-3h", everyMin: 60, creditsPerCheck: 0, essential: false, freshHours: 24, destination: "exchange_incident catalyst (to wire)" },
];

export type SourceState = { lastCheckAt?: string | null; suspended?: boolean };

/**
 * Is this source due? Event cadence: only inside [release − 30 min, release + 90 min] windows from the verified
 * official calendar, at most every 10 minutes. Fixed cadences: everyMin since the last check. Nonessential sources
 * are never due while the credit budget is suspended.
 */
export function isDue(src: Source, state: SourceState, now: number, releases: string[] = [], suspended = false): boolean {
  if (src.status !== "VERIFIED") return false;
  if (suspended && !src.essential && src.creditsPerCheck > 0) return false;
  const last = Date.parse(state.lastCheckAt ?? "");
  const since = Number.isFinite(last) ? (now - last) / 60_000 : Infinity;
  if (src.cadence === "on-demand") return false;
  if (src.cadence === "event") {
    const inWindow = releases.some((r) => {
      const t = Date.parse(r);
      return Number.isFinite(t) && now >= t - 30 * 60_000 && now <= t + 90 * 60_000;
    });
    return inWindow && since >= 10;
  }
  return since >= src.everyMin;
}

/** Content hash of normalised text: same story re-published (whitespace, case, tracking query) hashes the same. */
export function contentHash(title: string, body = ""): string {
  const norm = `${title}\n${body}`.toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/[^a-z0-9%.]+/g, " ").trim();
  return createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

/** Canonical URL: drops tracking params and fragments so syndicated copies collapse. */
export function canonicalUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|fbclid|gclid|mc_)/i.test(k)) u.searchParams.delete(k);
    return `${u.protocol}//${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`;
  } catch {
    return url;
  }
}

/** "6 hours ago" / RFC-822 / ISO → ISO, relative to retrieval time. Unparseable → null (never invented). */
export function normalisePublished(raw: string | null | undefined, retrievedAt: number): string | null {
  if (!raw) return null;
  const rel = /^(\d+)\s+(minute|hour|day|week)s?\s+ago$/i.exec(raw.trim());
  if (rel) {
    const unit = { minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 604_800_000 }[rel[2].toLowerCase() as "minute"];
    return new Date(retrievedAt - Number(rel[1]) * unit).toISOString();
  }
  const t = Date.parse(raw);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

export type Provenance = { sourceId: string; url: string; canonicalUrl: string; title: string; publishedAt: string | null; retrievedAt: string; hash: string; method: Method; trust: "official" | "news" | "aggregator"; note: "untrusted web content: research only, cannot trade" };

export function provenance(src: Source, item: { url: string; title: string; published?: string | null; body?: string }, retrievedAt: number): Provenance {
  const official = /\.(gov)(\/|$)/.test(new URL(item.url).host + "/");
  return {
    sourceId: src.id,
    url: item.url,
    canonicalUrl: canonicalUrl(item.url),
    title: item.title.slice(0, 300),
    publishedAt: normalisePublished(item.published, retrievedAt),
    retrievedAt: new Date(retrievedAt).toISOString(),
    hash: contentHash(item.title, item.body ?? ""),
    method: src.method,
    trust: official ? "official" : src.id === "gnews_rss" ? "aggregator" : "news",
    note: "untrusted web content: research only, cannot trade",
  };
}

/** Keep only fresh, never-seen items. Seen = same canonical URL OR same content hash. */
export function dedupeFresh(items: Provenance[], seen: Set<string>, freshHours: number, now: number): Provenance[] {
  const out: Provenance[] = [];
  for (const it of items) {
    const t = Date.parse(it.publishedAt ?? "");
    if (!Number.isFinite(t) || now - t > freshHours * 3_600_000) continue;
    if (seen.has(it.hash) || seen.has(it.canonicalUrl)) continue;
    seen.add(it.hash);
    seen.add(it.canonicalUrl);
    out.push(it);
  }
  return out;
}

/**
 * A news article never creates its own MiroFish job. It maps to the catalyst it is about (kind + scheduled date),
 * so ten copies of "CPI hotter than expected" all share one catalyst id and the pipeline's jobKey de-duplicates them.
 */
export function catalystIdForArticle(kind: string, scheduledDate: string | null, p: Provenance): string {
  if (scheduledDate) return `${kind}-${scheduledDate.slice(0, 10)}`;
  return `${kind}-story-${p.hash}`;
}

/* ---------------- Credit budget ---------------- */

export type BudgetConfig = { monthlyCeiling: number; alertAt: number[] };
export function budgetConfig(env: Record<string, string | undefined> = process.env): BudgetConfig {
  const n = Number(env.FIRECRAWL_MONTHLY_CREDIT_CEILING);
  return { monthlyCeiling: Number.isFinite(n) && n > 0 ? n : 12000, alertAt: [0.5, 0.8, 1] };
}

export type BudgetVerdict = { used: number; ceiling: number; fraction: number; alerts: string[]; suspendNonessential: boolean };
export function budgetVerdict(usedThisPeriod: number, cfg: BudgetConfig): BudgetVerdict {
  const fraction = usedThisPeriod / cfg.monthlyCeiling;
  const alerts = cfg.alertAt.filter((a) => fraction >= a).map((a) => `Firecrawl credits at ${Math.round(a * 100)}% of the ${cfg.monthlyCeiling}/month ceiling (${usedThisPeriod} used)`);
  return { used: usedThisPeriod, ceiling: cfg.monthlyCeiling, fraction, alerts, suspendNonessential: fraction >= 1 };
}

/** Monthly credits for a source at a cadence. Event sources: ~8 scheduled releases × 12 checks per window. */
export function monthlyCredits(src: Source, everyMin = src.everyMin): number {
  if (src.creditsPerCheck === 0) return 0;
  if (src.cadence === "event") return 8 * 12 * src.creditsPerCheck;
  if (src.cadence === "on-demand" || everyMin <= 0) return 0;
  return Math.round(((30 * 24 * 60) / everyMin) * src.creditsPerCheck);
}

/** Pay-as-you-go reference price from firecrawl.dev/pricing (Hobby: 1,000 extra credits per $5). */
export const USD_PER_CREDIT = 0.005;
