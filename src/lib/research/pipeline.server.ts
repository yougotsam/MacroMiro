/**
 * Real adapters for the research pipeline: Firecrawl seeder (+ Spark2 card when fresh), authenticated MiroFish
 * transport (127.0.0.1 only), catalysts from the verified official calendar, and the cost meter reader.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { scrapeArticle } from "@/lib/live/firecrawl.server";
import { MAJOR_EVENT, officialCalendarPath, verifyCalendar, type OfficialCalendar } from "@/lib/desk/official-calendar";
import { checkProvenance, publishedAtOf, SEED_DOCS, type SeedDoc } from "./provenance";
import { authHeaders } from "./mirofish-auth";
import type { Catalyst, CatalystKind, Seeder, Transport } from "./pipeline";
import type { LedgerEntry } from "./llm-meter";

export const OFFICIAL_SEED_PAGES: Partial<Record<CatalystKind, string[]>> = {
  cpi: ["https://www.bls.gov/news.release/cpi.nr0.htm", "https://www.clevelandfed.org/indicators-and-data/inflation-nowcasting"],
  ppi: ["https://www.bls.gov/news.release/ppi.nr0.htm"],
  nfp: ["https://www.bls.gov/news.release/empsit.nr0.htm"],
  fomc: ["https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"],
};

export function kindOf(name: string): CatalystKind | null {
  if (/consumer price|\bCPI\b/i.test(name)) return "cpi";
  if (/producer price|\bPPI\b/i.test(name)) return "ppi";
  if (/employment situation|nonfarm|non-farm|NFP/i.test(name)) return "nfp";
  if (/FOMC|Federal Reserve rate|Fed(?:eral)? funds/i.test(name)) return "fomc";
  return null;
}

/** Upcoming verified major events (event-driven only; never per 15-minute contract). */
export function catalystsFromCalendar(cal: OfficialCalendar, now: number, horizonMs: number): Catalyst[] {
  if (!verifyCalendar(cal, now).verified) return [];
  return cal.events
    .filter((e) => MAJOR_EVENT.test(e.name))
    .map((e) => ({ e, ms: /T/.test(e.when) ? Date.parse(e.when) : Date.parse(`${e.when}T18:00:00Z`) }))
    .filter(({ ms }) => ms >= now && ms <= now + horizonMs)
    .flatMap(({ e }) => {
      const kind = kindOf(e.name);
      if (!kind) return [];
      return [{ id: `${kind}-${e.when.slice(0, 16)}`, kind, name: e.name, when: e.when, assets: ["BTC", "ETH", "SOL", "XRP", "GOLD"], sources: [e.source, ...(OFFICIAL_SEED_PAGES[kind] ?? [])], verified: true }];
    });
}

function htmlText(h: string) {
  return h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
}

/** some official sites reject runtime TLS fingerprints; plain curl (no shell, fixed args, GET only) as a fallback */
function curlGet(url: string): string | null {
  try {
    const p = spawnSync("curl", [ "-s", "-L", "--max-time", "20", "--compressed", "-A", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", "-H", "Accept: text/html,application/xhtml+xml,*/*;q=0.8", "-H", "Accept-Language: en-US,en;q=0.9", "-H", `Referer: ${new URL(url).origin}/`, "-w", "\n%{http_code}", url], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
    const out = String(p.stdout ?? "");
    const code = out.slice(out.lastIndexOf("\n") + 1);
    return code === "200" ? out.slice(0, out.lastIndexOf("\n")) : null;
  } catch {
    return null;
  }
}

export const KIND_WORDS: Partial<Record<CatalystKind, RegExp>> = { cpi: /consumer price index/i, ppi: /producer price index/i, nfp: /employment situation|nonfarm payroll/i, fomc: /FOMC|Federal Open Market Committee/i };
export function relevant(text: string, c: Catalyst) {
  const re = KIND_WORDS[c.kind];
  return text.length >= 200 && (!re || re.test(text.slice(0, 4000)));
}

/** skip site navigation: start at the first substantial line that names the catalyst */
export function mainText(text: string, c: Catalyst) {
  const re = KIND_WORDS[c.kind];
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.length >= 120 && (!re || re.test(l)));
  return (i >= 0 ? lines.slice(i) : lines).join("\n");
}

/** counted (not priced) non-LLM provider usage, tagged with the current job */
function recordProvider(provider: "firecrawl" | "zep" | "other", units: number, unit: string, dir = process.env.RESEARCH_DIR || "/workspace/data/research") {
  try {
    const tag = existsSync(`${dir}/meter-tag`) ? readFileSync(`${dir}/meter-tag`, "utf8").trim() : "untagged";
    appendFileSync(`${dir}/provider-usage.jsonl`, JSON.stringify({ ts: new Date().toISOString(), tag, provider, units, unit }) + "\n");
  } catch { /* accounting only */ }
}

export async function fetchText(url: string): Promise<{ text: string; title: string; via: string }> {
  const r = await fetch(url, { redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", accept: "text/html,application/xhtml+xml,*/*;q=0.8", "accept-language": "en-US,en;q=0.9", referer: `${new URL(url).origin}/` }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
  let raw = r?.ok && r.url.split("#")[0] === url ? await r.text() : "";
  let via = "direct GET";
  if (!raw) { raw = curlGet(url) ?? ""; via = "direct GET (curl)"; }
  if (raw) return { text: htmlText(raw), title: raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() ?? "", via };
  const fc = await scrapeArticle(url).catch(() => ({ ok: false as const, error: "firecrawl failed" }));
  recordProvider("firecrawl", 1, "scrape credit (attempt)");
  return fc.ok ? { text: fc.markdown, title: fc.title, via: "firecrawl" } : { text: "", title: "", via: "none" };
}

/** Cleveland Fed page: keep only the nowcast tables (navigation dropped); empty when the tables are missing */
export function nowcastTables(text: string) {
  const flat = text.replace(/\s+/g, " ");
  const keep = ["Inflation, month-over-month percent change", "Inflation, year-over-year percent change"].map((h) => {
    const i = flat.indexOf(h);
    if (i < 0) return "";
    const j = flat.indexOf("Note:", i);
    return flat.slice(i, j > i ? j : i + 400);
  }).filter(Boolean);
  const stated = /every business day around 10:00 a\.m\. Eastern/i.test(flat) ? "Cleveland Fed states nowcasts are updated every business day around 10:00 a.m. Eastern. " : "";
  return keep.length ? `Cleveland Fed inflation nowcast (CPI = Consumer Price Index; model estimate, not an official release). ${stated}${keep.join(" | ")}` : "";
}

/** the verified official calendar entry for this catalyst, timestamped by the calendar's own fetch time */
function calendarDoc(c: Catalyst, calPath = officialCalendarPath()): SeedDoc | null {
  try {
    const cal = JSON.parse(readFileSync(calPath, "utf8")) as OfficialCalendar;
    const src = cal.sources.find((x) => x.ok && /bls\.gov/.test(x.url));
    const ev = cal.events.find((e) => e.when === c.when && kindOf(e.name) === c.kind);
    if (!src || !ev) return null;
    return { url: ev.source, title: `BLS release calendar: ${ev.name}`, text: `${ev.name} (${c.kind.toUpperCase()}) is scheduled by the ${ev.agency} official release calendar for ${ev.when} (UTC), 8:30 a.m. Eastern. Source: ${ev.source}. Calendar verified by content at ${src.fetchedAt}.`, publishedAt: src.fetchedAt, publishedBasis: "verified official calendar snapshot (fetch time)", fetchedAt: src.fetchedAt, docType: "schedule" };
  } catch {
    return null;
  }
}

/**
 * Catalyst-specific official documents only, each passed through the provenance gate (official host, not a homepage,
 * catalyst-specific, publication timestamp from the document, published before the sim start and before the event).
 * Rejected documents are recorded with their reason. No Spark card or news: they are not verified catalyst documents.
 */
export const officialSeeder: Seeder = async (c, simStartMs = Date.now()) => {
  const eventMs = Date.parse(c.when ?? "");
  const accepted: SeedDoc[] = [];
  const rejected: Array<{ url: string; reason: string }> = [];
  const consider = (doc: SeedDoc) => {
    const v = checkProvenance(doc, c.kind, simStartMs, Number.isFinite(eventMs) ? eventMs : simStartMs);
    if (v.ok) accepted.push(doc); else rejected.push({ url: doc.url, reason: v.reason });
  };
  const cal = calendarDoc(c);
  if (cal && (SEED_DOCS[c.kind] ?? []).some((d) => d.url === cal.url)) consider(cal);
  for (const { url, docType } of SEED_DOCS[c.kind] ?? []) {
    if (/\.ics$/.test(url)) continue;
    const fetchedAt = new Date().toISOString();
    const { text, title, via } = await fetchText(url);
    if (!text) { rejected.push({ url, reason: "fetch_failed" }); continue; }
    const pub = publishedAtOf(docType, url, text);
    consider({ url, title: `${title || url} [${via}]`, text: docType === "nowcast" ? nowcastTables(text) : mainText(text, c), publishedAt: pub.at, publishedBasis: pub.basis, fetchedAt, docType });
  }
  const head = [`# Research seed: ${c.name}`, c.when ? `Scheduled: ${c.when} (official calendar)` : "", `Seeded ${new Date(simStartMs).toISOString()}. Only official ${c.kind.toUpperCase()}-specific documents published before this time; context for a narrative simulation, not market data.`];
  const parts = accepted.map((d, i) => `## Source ${i + 1}: ${d.docType} (published ${d.publishedAt}; ${d.publishedBasis})\n${d.url}\n\n${d.text.slice(0, d.docType === "schedule" ? 600 : 2200)}`);
  return {
    text: [...head.filter(Boolean), "", ...parts].join("\n"),
    sources: accepted.map((d) => ({ url: d.url, title: d.title, fetchedAt: d.fetchedAt, publishedAt: d.publishedAt!, publishedBasis: d.publishedBasis, docType: d.docType })),
    rejected, spark: null,
  };
};
/** @deprecated name kept for callers; seeding is official-documents-only since round 3.3 */
export const firecrawlSeeder = officialSeeder;

/** Authenticated transport to the private backend. Refuses any non-loopback MiroFish URL. */
export function mirofishTransport(base = process.env.MIROFISH_URL || "http://127.0.0.1:5001"): Transport {
  const u = new URL(base);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) throw new Error("MiroFish must be a loopback URL");
  return async (path, init) => {
    const headers: Record<string, string> = { "Accept-Language": "en", ...authHeaders() };
    let body: BodyInit | undefined;
    if (init.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(init.json); }
    else if (init.form) body = init.form;
    const r = await fetch(`${base.replace(/\/+$/, "")}${path}`, { method: init.method, headers, body, signal: AbortSignal.timeout(init.timeoutMs) });
    const txt = await r.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(txt); } catch { parsed = null; }
    return { status: r.status, body: parsed };
  };
}

export function meterSpent(ledger = "/workspace/data/research/llm-usage.jsonl") {
  return (jobId: string) => {
    if (!existsSync(ledger)) return null;
    const rows = readFileSync(ledger, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LedgerEntry).filter((e) => e.tag === jobId);
    return rows.length ? Number(rows.reduce((a, e) => a + e.costUsd, 0).toFixed(4)) : null;
  };
}
