/** Free Alexandria discovery (search sources:["alexandria"] + find-tools). Never executes paid tools, never accepts terms. */
import { mkdirSync, writeFileSync } from "node:fs";
import { fc } from "../../src/lib/grid/fc.server";
import { DATA_ROOT } from "../../src/lib/data-root";

const QUERIES = ["US CPI inflation economic data release", "federal reserve interest rates FOMC", "treasury yields auctions", "FRED economic time series", "GDP PCE BEA", "nonfarm payrolls jobs report", "gold price COMEX futures", "commitments of traders positioning", "bitcoin price index", "crypto exchange announcements outages", "SEC filings EDGAR", "ETF filings flows", "economic calendar consensus forecast", "financial news headlines", "prediction market kalshi"];
const tools = new Map<string, Record<string, unknown>>();
for (const q of QUERIES) {
  const r = await fc("POST", "search", "discovery", { query: q, sources: ["alexandria"], limit: 8 });
  for (const t of ((r.json.data as { tools?: Record<string, unknown>[] })?.tools ?? [])) tools.set(`${t.provider}/${t.capability}`, { ...t, query: q });
}
const providers = [...new Set([...tools.values()].map((t) => String(t.provider)))];
const details: Record<string, unknown> = {};
for (const p of providers) {
  const r = await fc("POST", "scrape", "discovery", { alexandria: [{ provider: "firecrawl", capability: "find-tools", options: { providers: [p], limit: 20 } }] });
  details[p] = { http: r.http, credits: r.credits, error: r.error, data: r.json.data };
}
mkdirSync(`${DATA_ROOT}/research`, { recursive: true });
writeFileSync(`${DATA_ROOT}/research/alexandria-discovery.json`, JSON.stringify({ at: new Date().toISOString(), tools: [...tools.values()], details }, null, 1));
console.log(providers.length, "providers;", tools.size, "tools");
