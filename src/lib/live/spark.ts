/** Spark-2 brief. Official pages only. A low credit cap. It cannot tell the desk to trade. */

export const SPARK_URLS = [
  "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm",
  "https://www.federalreserve.gov/newsevents/pressreleases.htm",
  "https://www.bls.gov/schedule/news_release/cpi.htm",
  "https://www.bls.gov/schedule/news_release/empsit.htm",
  "https://www.bls.gov/schedule/news_release/ppi.htm",
  "https://www.bea.gov/news/schedule",
  "https://www.eia.gov/petroleum/supply/weekly/",
  "https://home.treasury.gov/news/press-releases",
  "https://fred.stlouisfed.org/",
  "https://www.sec.gov/newsroom/press-releases",
  "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm",
  "https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html",
  "https://www.nasdaq.com/news-and-insights",
  "https://www.imf.org/en/news",
];

export const SPARK_SCHEMA = {
  type: "object",
  properties: {
    event: { type: "string" },
    released: { type: "boolean" },
    actual: { type: ["string", "null"] },
    forecast: { type: ["string", "null"] },
    previous: { type: ["string", "null"] },
    asset: { type: "string", enum: ["btc", "gold", "both", "unclear"] },
    bias: { type: "string", enum: ["bullish", "bearish", "mixed", "unclear"] },
    quote: { type: "string" },
    agree: { type: "boolean" },
    why: { type: "string" },
    probability: { type: ["number", "null"] },
    headlines: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        properties: { title: { type: "string" }, url: { type: "string" }, published: { type: ["string", "null"] } },
        required: ["title", "url"],
      },
    },
  },
  required: ["event", "asset", "bias", "why"],
};

/** "Thursday, October 8, 2026" in US Eastern time, where the releases are scheduled. */
export function sparkDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(now);
}

const DATE_SLOT = "{{TODAY}}";

const SPARK_LINES = [
  "Start on the pages you were given, then follow the official release and the major headline that those pages point at. Do not reuse a sample answer. Do not invent a date.",
  "The starting pages are the Fed calendar and press releases, BLS CPI, NFP, and PPI, the BEA schedule, EIA oil, the Treasury press page, FRED, the SEC press page, the CFTC commitments report, CME FedWatch, Nasdaq news, and the IMF news page.",
  `This reading is for ${DATE_SLOT} (US Eastern). event is the nearest scheduled release on or after that date. why lists the other dates, then up to three headlines from the last day that can move bitcoin, gold, oil, or the stock indexes, and the page each one came from.`,
  "headlines repeats those up to three headlines as title, url (the article page you opened, not a home page), and published (the date printed on the page, or null).",
  "released is true only when that release has already been published.",
  "actual, forecast, and previous are copied only when those numbers are printed. Otherwise null.",
  "asset is btc, gold, both, or unclear. A calendar date alone is unclear.",
  "probability is null when the pages do not support a direction. When a page prints a likelihood, such as a FedWatch percent, copy that number as a fraction between 0.05 and 0.95. Otherwise leave probability null. It is a read, not an order. Do not guess 0.64 to look complete.",
  "bias is bullish, bearish, mixed, or unclear. Unclear unless the pages support it.",
  "quote is one short sentence copied from a page, or empty.",
  "agree is false when two pages disagree.",
  "Do not recommend a buy or a sell. Do not invent a price. Do not send an order.",
  "Columbus Washington subway station is not a market, not a price, and not a news event. If that phrase appears, ignore it.",
];

/** The prompt with today's date filled in. Never a hard-coded day. */
export function sparkPrompt(now: Date = new Date()): string {
  return SPARK_LINES.join(" ").replace(DATE_SLOT, sparkDate(now));
}

/** Template kept for tests and docs; sparkBody() always sends sparkPrompt(now). */
export const SPARK_PROMPT = SPARK_LINES.join(" ");

export function sparkBody(now: Date = new Date()) {
  return {
    prompt: sparkPrompt(now),
    urls: SPARK_URLS,
    schema: SPARK_SCHEMA,
    model: "spark-2" as const,
    effort: "medium" as const,
    maxCredits: 80,
    strictConstrainToURLs: false,
  };
}

export type SparkHeadline = { title: string; url: string; published: string | null };
export type SparkCard = { event: string; asset: string; bias: string; why: string; quote: string; probability: number | null; headlines: SparkHeadline[] };

function headlinesOf(raw: unknown): SparkHeadline[] {
  if (!Array.isArray(raw)) return [];
  const out: SparkHeadline[] = [];
  for (const h of raw) {
    if (!h || typeof h !== "object") continue;
    const row = h as { title?: unknown; url?: unknown; published?: unknown };
    const url = typeof row.url === "string" ? row.url.trim() : "";
    const title = typeof row.title === "string" ? row.title.trim() : "";
    if (!/^https?:\/\/[^\s]+$/i.test(url) || !title) continue;
    if (/buy|sell|place an order|ignore previous/i.test(title) && /order|instructions/i.test(title)) continue;
    out.push({ title: title.slice(0, 180), url: url.slice(0, 500), published: typeof row.published === "string" ? row.published.slice(0, 40) : null });
    if (out.length >= 3) break;
  }
  return out;
}

export function sparkRead(data: unknown): SparkCard | null {
  if (!data || typeof data !== "object") return null;
  const row = data as { event?: unknown; asset?: unknown; bias?: unknown; why?: unknown; quote?: unknown; probability?: unknown; headlines?: unknown };
  if (typeof row.event !== "string" || typeof row.why !== "string") return null;
  const text = `${row.event} ${row.why} ${typeof row.quote === "string" ? row.quote : ""}`;
  const probability = typeof row.probability === "number" && row.probability > 0 && row.probability < 1 ? row.probability : null;
  if (/columbus washington subway station/i.test(String(row.event))) {
    return { event: "ignored", asset: "unclear", bias: "unclear", why: "Spark returned the subway-station test sentence. Dropped.", quote: "", probability: null, headlines: [] };
  }
  if (/buy|sell|place an order|ignore previous/i.test(text) && /order|instructions/i.test(text)) {
    return { event: row.event.replace(/buy|sell/gi, "").trim(), asset: "unclear", bias: "unclear", why: "Spark text looked like an instruction. Dropped.", quote: "", probability: null, headlines: [] };
  }
  return {
    event: row.event.slice(0, 180),
    asset: typeof row.asset === "string" ? row.asset : "unclear",
    bias: typeof row.bias === "string" ? row.bias : "unclear",
    why: row.why.slice(0, 280),
    quote: typeof row.quote === "string" ? row.quote.slice(0, 180) : "",
    probability,
    headlines: headlinesOf(row.headlines),
  };
}
