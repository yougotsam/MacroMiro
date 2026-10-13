/** Classify discovered Alexandria providers from saved discovery/terms files (0 credits). */
import { readFileSync, writeFileSync } from "node:fs";
import { DATA_ROOT } from "../../src/lib/data-root";
import { classifyProvider, toolsFrom } from "../../src/lib/grid/alexandria";
const R = `${DATA_ROOT}/research`;
const disc = JSON.parse(readFileSync(`${R}/alexandria-discovery.json`, "utf8"));
const terms = JSON.parse(readFileSync(`${R}/alexandria-terms.json`, "utf8"));
const rows = Object.entries(disc.details as Record<string, { http: number; error: string; data: unknown }>).map(([provider, d]) => {
  let tools = toolsFrom(d.data);
  let http = d.http;
  if (!tools.length && terms[`tools:${provider}`]) { tools = toolsFrom(terms[`tools:${provider}`]); if (tools.length) http = 200; }
  const t = terms[`terms:${provider}`]?.data?.alexandria?.[0]?.data;
  const status = classifyProvider({ provider, findToolsHttp: http, termsRequired: t ? Boolean(t.required) : null, termsAccepted: t?.status?.accepted ?? null, error: tools.length ? "" : d.error });
  const prices = [...new Set(tools.map((x) => x.creditsCost))];
  return { provider, status, terms: t ? (t.required ? "required" : "not required") : "not checked", price: prices.length ? `${prices.join("/")} credits per call` : "unknown", tools: tools.length, capabilities: tools.slice(0, 12).map((x) => x.capability) };
});
writeFileSync(`${R}/alexandria-providers.json`, JSON.stringify(rows, null, 1));
for (const r of rows) console.log(r.provider, r.status, r.terms, r.price, r.tools);
