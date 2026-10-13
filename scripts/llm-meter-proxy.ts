/**
 * Local LLM cost meter + hard budget for MiroFish (127.0.0.1 only).
 *   METER_BUDGET_USD=0.90 METER_TAG=<job> METER_LEDGER=<file> bun scripts/llm-meter-proxy.ts [port]
 * MiroFish uses MIROFISH_LLM_METER_URL=http://127.0.0.1:<port>/generativelanguage.googleapis.com/v1beta/openai/
 * Forwards only to allow-listed provider hosts; never logs headers or bodies; refuses (429) once the budget is spent.
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { costOf, costReport, estimateUsage, spent, upstreamOf, usageFrom, type LedgerEntry, type ProviderEntry } from "../src/lib/research/llm-meter";

const port = Number(process.argv[2] ?? 5098);
const budget = Number(process.env.METER_BUDGET_USD ?? "0.9");
const ledger = process.env.METER_LEDGER ?? "/workspace/data/research/llm-usage.jsonl";
const tagFile = process.env.METER_TAG_FILE ?? "/workspace/data/research/meter-tag";
const tagNow = () => (existsSync(tagFile) ? readFileSync(tagFile, "utf8").trim() : process.env.METER_TAG ?? "untagged");
const providerLedger = process.env.METER_PROVIDER_LEDGER ?? "/workspace/data/research/provider-usage.jsonl";
const providerEntries = (): ProviderEntry[] => (existsSync(providerLedger) ? readFileSync(providerLedger, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l) as ProviderEntry]; } catch { return []; } }) : []);
const entries: LedgerEntry[] = existsSync(ledger) ? readFileSync(ledger, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as LedgerEntry) : [];

Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/__meter") return Response.json({ budgetUsd: budget, spentUsd: spent(entries), calls: entries.length, tag: tagNow(), byProvider: costReport(entries, providerEntries(), budget) });
    const up = upstreamOf(url.pathname);
    if (!up) return new Response("upstream not allowed", { status: 403 });
    if (spent(entries) >= budget) return Response.json({ error: { message: `compute budget exhausted ($${budget})`, type: "budget" } }, { status: 429 });
    const reqBody = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
    const headers = new Headers(req.headers);
    headers.delete("host");
    headers.delete("content-length");
    headers.delete("accept-encoding");
    const res = await fetch(up + url.search, { method: req.method, headers, body: reqBody || undefined });
    const text = await res.text();
    const model = (() => { try { return String(JSON.parse(reqBody).model ?? "unknown"); } catch { return "unknown"; } })();
    const u = usageFrom(text);
    const usage = u ?? estimateUsage(reqBody, text);
    const e: LedgerEntry = { ts: new Date().toISOString(), tag: tagNow(), model, status: res.status, prompt: usage.prompt, completion: usage.completion, estimated: !u, costUsd: costOf(model, usage) };
    entries.push(e);
    appendFileSync(ledger, JSON.stringify(e) + "\n");
    const out = new Headers(res.headers);
    out.delete("content-encoding");
    out.delete("content-length");
    return new Response(text, { status: res.status, headers: out });
  },
});
console.log(`llm meter on 127.0.0.1:${port} budget $${budget} ledger ${ledger}`);
