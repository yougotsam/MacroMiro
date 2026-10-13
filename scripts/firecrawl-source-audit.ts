/**
 * Firecrawl / news source audit (read-only). Free GETs for RSS/iCal/API sources; Firecrawl account endpoints
 * (credit usage, monitors) cost 0 credits. `--scrape` adds ONE 1-credit Firecrawl scrape of the BLS CPI schedule.
 * Never prints the API key. Fetched content is untrusted: only status, size, item count and newest date are kept.
 * Output: <DATA_ROOT>/research/firecrawl-audit.json
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { SOURCES, normalisePublished } from "../src/lib/intel/sources";
import { DATA_ROOT } from "../src/lib/data-root";

const KEY = (process.env.FIRECRAWL_API_KEY ?? "").trim();
const UA = { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) macromiro-desk-calendar", accept: "*/*", "accept-language": "en-US,en;q=0.9" };

async function probe(url: string) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    const text = await r.text();
    const dates = [...text.matchAll(/<(?:pubDate|updated|lastBuildDate)>(?:<!\[CDATA\[)?([^<\]]+)/g)].map((m) => normalisePublished(m[1].trim(), Date.now())).filter(Boolean) as string[];
    const items = (text.match(/<item[\s>]|<entry[\s>]|BEGIN:VEVENT/g) ?? []).length;
    return { http: r.status, bytes: text.length, items, newest: dates.sort().at(-1) ?? null, ms: Date.now() - t0 };
  } catch (e) {
    return { http: 0, bytes: 0, items: 0, newest: null, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
  }
}

async function fc(path: string, init?: RequestInit) {
  if (!KEY) return { error: "FIRECRAWL_API_KEY not set" };
  const r = await fetch(`https://api.firecrawl.dev/v2/${path}`, { ...init, headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(60_000) });
  return (await r.json().catch(() => ({ error: `http ${r.status}` }))) as Record<string, unknown>;
}

const at = new Date().toISOString();
const free = SOURCES.filter((s) => s.creditsPerCheck === 0 && !s.url.includes("api.firecrawl.dev"));
const extra = [{ id: "kraken_status", url: "https://status.kraken.com/history.rss" }];
const results: Record<string, unknown> = {};
for (const s of [...free, ...extra]) results[s.id] = { url: s.url, ...(await probe(s.url)) };

const usage = await fc("team/credit-usage");
const history = await fc("team/credit-usage/historical");
const monitors = (await fc("monitor")) as { data?: { id: string; name: string; status: string; schedule: unknown; targets: { urls: string[] }[]; estimatedCreditsPerMonth: number; lastRunAt: string; lastCheckSummary: unknown }[] };
let scrape: unknown = "skipped (pass --scrape)";
if (process.argv.includes("--scrape")) {
  const r = (await fc("scrape", { method: "POST", body: JSON.stringify({ url: "https://www.bls.gov/schedule/news_release/cpi.htm", formats: ["markdown"], onlyMainContent: true, maxAge: 0 }) })) as { success?: boolean; data?: { markdown?: string; metadata?: { statusCode?: number; creditsUsed?: number } } };
  const md = r.data?.markdown ?? "";
  scrape = { success: r.success, status: r.data?.metadata?.statusCode, credits: r.data?.metadata?.creditsUsed, bytes: md.length, mentionsOct14: /Oct\.?\s*14,\s*2026/.test(md) };
}
const out = {
  at,
  note: "research audit only; no orders",
  direct: results,
  firecrawl: { usage, history, monitors: (monitors.data ?? []).map((m) => ({ id: m.id, name: m.name, status: m.status, schedule: m.schedule, urls: m.targets.flatMap((t) => t.urls), estCreditsPerMonth: m.estimatedCreditsPerMonth, lastRunAt: m.lastRunAt, last: m.lastCheckSummary })), scrape },
};
mkdirSync(`${DATA_ROOT}/research`, { recursive: true });
writeFileSync(`${DATA_ROOT}/research/firecrawl-audit.json`, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ at, direct: Object.fromEntries(Object.entries(results).map(([k, v]) => [k, `${(v as { http: number }).http} items=${(v as { items: number }).items} newest=${(v as { newest: string | null }).newest}`])), usage, monitors: out.firecrawl.monitors.length, scrape }, null, 1));
