import { scrapeArticle, searchNews } from "@/lib/live/firecrawl.server";
import { hostile } from "@/lib/intel/guard";
import { cardSeed, freshSparkCard, type KnockSeed } from "@/lib/intel/mirofish";
import { sparkDate } from "@/lib/live/spark";

/**
 * Builds the MiroFish Knock seed from today's news, not one headline line:
 *   1. the fresh (< 6 h) Spark card (event, why, quote, bias),
 *   2. the article pages Spark cited (card.headlines[].url),
 *   3. Firecrawl news search (last day) on the card's event, to fill up to MAX_ARTICLES,
 *   4. each page fetched by Firecrawl /scrape as main-content markdown, links and images stripped.
 * Context for the simulated crowd only. Nothing here reaches an order, a price, or the 15-minute rule.
 */
const MAX_ARTICLES = 5;
const PER_ARTICLE = 5000;
const TOTAL = 24000;

function cleanMarkdown(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() && !hostile(l) && !/^(share|subscribe|sign up|advertisement|cookie)/i.test(l.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function searchQuery(event: string): string {
  // Spark events read like "U.S. International Trade ... (BEA; scheduled October 6, 2026 at 8:30 AM)". Drop the bracket.
  return event.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Federal Reserve markets bitcoin gold";
}

export async function buildKnockSeed(headline: string): Promise<KnockSeed> {
  const raw = freshSparkCard();
  if (!raw?.card) return cardSeed(headline);
  const card = raw.card as NonNullable<typeof raw.card> & { headlines?: { title: string; url: string; published: string | null }[] };
  const picks: { title: string; url: string; date: string }[] = [];
  const seen = new Set<string>();
  const add = (title: string, url: string, date: string) => {
    const key = url.replace(/[?#].*$/, "");
    if (seen.has(key) || picks.length >= MAX_ARTICLES) return;
    seen.add(key);
    picks.push({ title, url, date });
  };
  for (const h of card.headlines ?? []) add(h.title, h.url, h.published ?? "");
  const searched = await searchNews(searchQuery(card.event || headline), MAX_ARTICLES).catch(() => null);
  for (const r of searched?.items ?? []) add(r.title, r.url, r.date);
  if (picks.length < 3) {
    const wide = await searchNews("Federal Reserve dollar bitcoin gold markets", MAX_ARTICLES).catch(() => null);
    for (const r of wide?.items ?? []) add(r.title, r.url, r.date);
  }

  const pages = await Promise.all(picks.map(async (p) => ({ p, page: await scrapeArticle(p.url).catch(() => ({ ok: false as const, error: "fetch failed" })) })));
  const parts: string[] = [];
  const sources: { title: string; url: string }[] = [];
  let used = 0;
  for (const { p, page } of pages) {
    if (!page.ok) continue;
    const body = cleanMarkdown(page.markdown).slice(0, PER_ARTICLE);
    if (body.length < 200 || used >= TOTAL) continue;
    const take = body.slice(0, TOTAL - used);
    used += take.length;
    const title = p.title || page.title || p.url;
    sources.push({ title, url: p.url });
    parts.push(`## Article ${sources.length}: ${title}\nSource: ${p.url}${p.date ? `\nPublished: ${p.date}` : ""}\n\n${take}`);
  }
  if (!sources.length) return cardSeed(headline);

  const head = [
    `# MacroMiro Knock seed for ${sparkDate()} (US Eastern)`,
    `Built ${new Date().toISOString()} from the Firecrawl Spark card (${raw.at}) and ${sources.length} articles fetched by Firecrawl.`,
    "",
    "## Spark card",
    `Event: ${card.event || headline}`,
    card.why ? `Why: ${card.why}` : "",
    card.quote ? `Quote: ${card.quote}` : "",
    card.bias ? `Bias on the pages: ${card.bias}` : "",
    card.asset ? `Asset: ${card.asset}` : "",
  ].filter((l) => l !== "");
  return { text: [...head, "", ...parts].join("\n\n").replace(/\n{3,}/g, "\n\n"), sources, from: "firecrawl" };
}
