/**
 * Real adapters for the research pipeline: Firecrawl seeder (+ Spark2 card when fresh), authenticated MiroFish
 * transport (127.0.0.1 only), catalysts from the verified official calendar, and the cost meter reader.
 */
import { existsSync, readFileSync } from "node:fs";
import { freshSparkCard } from "@/lib/intel/mirofish";
import { scrapeArticle } from "@/lib/live/firecrawl.server";
import { MAJOR_EVENT, verifyCalendar, type OfficialCalendar } from "@/lib/desk/official-calendar";
import { authHeaders } from "./mirofish-auth";
import type { Catalyst, CatalystKind, Seeder, Transport } from "./pipeline";
import type { LedgerEntry } from "./llm-meter";

export const OFFICIAL_SEED_PAGES: Partial<Record<CatalystKind, string[]>> = {
  cpi: ["https://www.bls.gov/news.release/cpi.nr0.htm"],
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

/** Firecrawl first; a direct public GET of the official page as fallback. Every source carries fetchedAt. */
export const firecrawlSeeder: Seeder = async (c) => {
  const parts: string[] = [];
  const sources: Array<{ url: string; title: string; fetchedAt: string }> = [];
  const pages = [...new Set(c.sources.filter((u) => !/\.ics$/.test(u)))];
  for (const url of pages) {
    const at = new Date().toISOString();
    let text = "", title = "", via = "";
    const fc = await scrapeArticle(url).catch(() => ({ ok: false as const, error: "firecrawl failed" }));
    if (fc.ok) { text = fc.markdown; title = fc.title; via = "firecrawl"; }
    else {
      const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) macromiro-research", accept: "text/html", "accept-language": "en-US" }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
      if (r?.ok) { text = htmlText(await r.text()); via = "direct GET"; }
    }
    if (text.length < 200) continue;
    sources.push({ url, title: title || url, fetchedAt: at });
    parts.push(`## Source ${sources.length} (${via}, fetched ${at})\n${url}\n\n${text.slice(0, 2500)}`);
  }
  const spark = freshSparkCard();
  const sparkCard = spark?.card ? { event: String(spark.card.event ?? ""), at: spark.at } : null;
  const head = [`# Research seed: ${c.name}`, c.when ? `Scheduled: ${c.when} (official calendar)` : "", `Built ${new Date().toISOString()}. Official sources only; this is context for a narrative simulation, not market data.`];
  if (sparkCard && spark?.card) head.push("", `## Spark2 card (${spark.at})`, `Event: ${spark.card.event ?? ""}`, spark.card.why ? `Why: ${spark.card.why}` : "");
  return { text: [...head.filter(Boolean), "", ...parts].join("\n"), sources, spark: sparkCard };
};

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
