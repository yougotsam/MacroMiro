import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { pushInbox, type InboxEvent } from "@/lib/printgate/inbox.server";
import { DATA_ROOT } from "@/lib/data-root";
import { spendAllowed } from "@/lib/ops/operating-mode";

const API = "https://api.firecrawl.dev/v2";
const KEY_FILES = ["/workspace/.grok/secrets/fc"];

function key() {
  const env = (process.env.FIRECRAWL_API_KEY ?? "").trim();
  if (env.startsWith("fc-")) return env;
  for (const path of KEY_FILES) {
    try {
      const disk = readFileSync(path, "utf8").trim();
      if (disk.startsWith("fc-")) {
        process.env.FIRECRAWL_API_KEY = disk;
        return disk;
      }
    } catch {
      /* try next */
    }
  }
  return "";
}

export function firecrawlKey() {
  return key();
}

export function firecrawlReady() {
  return key().startsWith("fc-");
}

const pageCache = new Map<string, { at: number; markdown: string }>();

const WATCH = [
  { watchId: "fed_fomc", eventClass: "fomc", url: "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm" },
  { watchId: "bls_cpi", eventClass: "cpi", url: "https://www.bls.gov/schedule/news_release/cpi.htm" },
  { watchId: "bls_nfp", eventClass: "nfp", url: "https://www.bls.gov/schedule/news_release/empsit.htm" },
  { watchId: "eia_oil", eventClass: "eia", url: "https://www.eia.gov/petroleum/supply/weekly/" },
];

async function scrape(url: string): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> {
  const hit = pageCache.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return { ok: true, markdown: hit.markdown };
  if (!firecrawlReady()) return { ok: false, error: "no key" };
  const gate = spendAllowed("radar_official_scrape");
  if (!gate.ok) return { ok: false, error: gate.reason };
  const res = await fetch(`${API}/scrape`, {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown"] }),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: { markdown?: string }; error?: string };
  const markdown = json.data?.markdown ?? "";
  if (!res.ok || !markdown) return { ok: false, error: json.error || `scrape http ${res.status}` };
  pageCache.set(url, { at: Date.now(), markdown });
  return { ok: true, markdown };
}

export async function pullOfficial(): Promise<{ live: boolean; events: InboxEvent[]; errors: string[] }> {
  if (!firecrawlReady()) return { live: false, events: [], errors: ["Firecrawl key missing on server"] };
  const errors: string[] = [];
  const events: InboxEvent[] = [];
  for (const row of WATCH) {
    const page = await scrape(row.url);
    if (!page.ok) {
      errors.push(`${row.watchId}: ${page.error}`);
      continue;
    }
    const ev: InboxEvent = {
      id: `${row.watchId}-${Date.now()}`,
      receivedAt: new Date().toISOString(),
      type: "scrape",
      url: row.url,
      watchId: row.watchId,
      eventClass: row.eventClass,
      judgment: page.markdown.replace(/\s+/g, " ").trim().slice(0, 280),
      rawType: "scrape",
    };
    events.push(ev);
    pushInbox(ev);
  }
  return { live: true, events, errors };
}

export async function startAgent(body: unknown) {
  if (!firecrawlReady()) return { ok: false as const, id: null, error: "no key" };
  const gate = spendAllowed("intel_clerks");
  if (!gate.ok) return { ok: false as const, id: null, error: gate.reason };
  const res = await fetch(`${API}/agent`, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !json.id) return { ok: false as const, id: null, error: json.error || `http ${res.status}` };
  return { ok: true as const, id: json.id, error: "" };
}

export async function agentStatus(id: string) {
  const res = await fetch(`${API}/agent/${id}`, { signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${key()}` } });
  const json = (await res.json().catch(() => ({}))) as { status?: string; data?: unknown; creditsUsed?: number; error?: string; expiresAt?: string };
  return { ok: res.ok, status: json.status || "failed", data: json.data ?? null, creditsUsed: json.creditsUsed ?? null, error: json.error || "", expiresAt: json.expiresAt ?? null };
}

export async function agentTrace(id: string) {
  const res = await fetch(`${API}/agent/${id}/trace`, { signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${key()}` } });
  const json = (await res.json().catch(() => ({}))) as { events?: unknown[]; creditsUsed?: number; activeBrowserSessions?: { liveViewUrl?: string }[] };
  return { ok: res.ok, events: json.events ?? [], creditsUsed: json.creditsUsed ?? null, live: json.activeBrowserSessions?.[0]?.liveViewUrl ?? "" };
}

export async function ensureMonitor() {
  const file = `${DATA_ROOT}/monitor.json`;
  let saved: { id?: string | null } = {};
  try {
    saved = JSON.parse(readFileSync(file, "utf8")) as { id?: string | null };
  } catch {
    /* first create */
  }
  if (!firecrawlReady()) return { id: null, status: "no key", checks: 0, error: "no key" };
  if (saved.id) {
    const res = await fetch(`${API}/monitor/${saved.id}/checks`, { signal: AbortSignal.timeout(12000), headers: { Authorization: `Bearer ${key()}` } });
    const json = (await res.json().catch(() => ({}))) as { checks?: unknown[]; data?: unknown[]; error?: string };
    const checks = json.checks || json.data || [];
    return { id: saved.id, status: res.ok ? "polling" : "error", checks: Array.isArray(checks) ? checks.length : 0, error: res.ok ? "" : json.error || `http ${res.status}` };
  }
  const gate = spendAllowed("calendar_monitors");
  if (!gate.ok) return { id: null, status: "standby", checks: 0, error: gate.reason };
  const res = await fetch(`${API}/monitor`, {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Envelope official calendars",
      schedule: { cron: "0 */6 * * *", timezone: "America/New_York" },
      targets: [
        { type: "scrape", urls: ["https://www.bls.gov/schedule/news_release/cpi.htm", "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"] },
      ],
    }),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; data?: { id?: string }; monitor?: { id?: string }; error?: string; message?: string };
  const id = json.id || json.data?.id || json.monitor?.id || null;
  if (id) {
    mkdirSync(DATA_ROOT, { recursive: true });
    writeFileSync(file, JSON.stringify({ id }));
  }
  return { id, status: res.ok && id ? "created" : "error", checks: 0, error: res.ok ? "" : json.error || json.message || `http ${res.status}` };
}

export async function cancelAgent(id: string) {
  const res = await fetch(`${API}/agent/${id}`, { method: "DELETE", signal: AbortSignal.timeout(8000), headers: { Authorization: `Bearer ${key()}` } });
  return { ok: res.ok, status: res.status };
}

export async function searchWeb(query: string) {
  if (!firecrawlReady()) return { ok: false as const, error: "no key", data: [] as unknown[] };
  const gate = spendAllowed("news_search");
  if (!gate.ok) return { ok: false as const, error: gate.reason, data: [] as unknown[] };
  const res = await fetch(`${API}/search`, {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit: 5 }),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: unknown[]; error?: string };
  return { ok: res.ok, error: json.error || "", data: json.data ?? [] };
}

/** Firecrawl news search (last day by default). Titles and links only; nothing here can trade. */
export async function searchNews(query: string, limit = 5, tbs = "qdr:d") {
  if (!firecrawlReady()) return { ok: false as const, error: "no key", items: [] as { title: string; url: string; date: string }[] };
  const gate = spendAllowed("mirofish_seeding");
  if (!gate.ok) return { ok: false as const, error: gate.reason, items: [] as { title: string; url: string; date: string }[] };
  const res = await fetch(`${API}/search`, {
    method: "POST",
    signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit, sources: ["news"], tbs }),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: { news?: { title?: string; url?: string; date?: string }[]; web?: { title?: string; url?: string }[] }; error?: string };
  const rows = [...(json.data?.news ?? []), ...(json.data?.web ?? [])];
  const items = rows
    .filter((r) => typeof r.url === "string" && /^https?:\/\//.test(r.url))
    .map((r) => ({ title: String(r.title ?? "").slice(0, 180), url: String(r.url), date: String((r as { date?: string }).date ?? "") }));
  return { ok: res.ok, error: res.ok ? "" : json.error || `search http ${res.status}`, items };
}

/** One article as main-content markdown (cached 10 minutes). */
export async function scrapeArticle(url: string): Promise<{ ok: true; markdown: string; title: string } | { ok: false; error: string }> {
  const hit = pageCache.get(`article:${url}`);
  if (hit && Date.now() - hit.at < 10 * 60_000) return { ok: true, markdown: hit.markdown, title: "" };
  if (!firecrawlReady()) return { ok: false, error: "no key" };
  const gate = spendAllowed("mirofish_seeding");
  if (!gate.ok) return { ok: false, error: gate.reason };
  let res: Response;
  try {
    res = await fetch(`${API}/scrape`, {
      method: "POST",
      signal: AbortSignal.timeout(45000),
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const json = (await res.json().catch(() => ({}))) as { data?: { markdown?: string; metadata?: { title?: string } }; error?: string };
  const markdown = json.data?.markdown ?? "";
  if (!res.ok || !markdown) return { ok: false, error: json.error || `scrape http ${res.status}` };
  pageCache.set(`article:${url}`, { at: Date.now(), markdown });
  return { ok: true, markdown, title: String(json.data?.metadata?.title ?? "") };
}
