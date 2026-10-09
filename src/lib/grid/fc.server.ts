/**
 * Firecrawl REST client for the Intel Grid. RESEARCH ONLY.
 * - Every call is logged (endpoint, category, credits, job id, status) to <DATA_ROOT>/research/grid-calls.jsonl.
 * - A per-round credit budget (GRID_ROUND_CREDIT_BUDGET, default 5000) refuses new paid calls once reached.
 * - Paid calls also go to the monthly ledger used by the auto-suspension ceiling.
 * - The API key is read from FIRECRAWL_API_KEY (or the existing key file) and never logged or returned.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { DATA_ROOT } from "@/lib/data-root";
import { firecrawlKey } from "@/lib/live/firecrawl.server";
import { recordCredits } from "@/lib/intel/budget.server";

export const API = "https://api.firecrawl.dev/v2";
export type Category = "account" | "discovery" | "scrape" | "search" | "agent" | "monitor" | "alexandria" | "parse" | "map";
export type CallLog = { at: string; method: string; path: string; category: Category; http: number; ok: boolean; credits: number; jobId: string | null; note?: string };

const LOG = () => `${DATA_ROOT}/research/grid-calls.jsonl`;

export function roundBudget(env: Record<string, string | undefined> = process.env) {
  const n = Number(env.GRID_ROUND_CREDIT_BUDGET);
  return Number.isFinite(n) && n > 0 ? n : 5000;
}

export function roundSpent(): number {
  try {
    return readFileSync(LOG(), "utf8").split("\n").filter(Boolean).reduce((a, l) => a + (Number((JSON.parse(l) as CallLog).credits) || 0), 0);
  } catch {
    return 0;
  }
}

/** Poll-safe: a job's credits are counted once even if its status is polled many times. */
export function logCall(row: CallLog) {
  if (row.credits > 0 && row.jobId) {
    try {
      if (readFileSync(LOG(), "utf8").split("\n").some((l) => l.includes(`"jobId":${JSON.stringify(row.jobId)}`) && !l.includes('"credits":0,'))) row = { ...row, credits: 0, note: "credits already counted for this job" };
    } catch {
      /* first call */
    }
  }
  mkdirSync(`${DATA_ROOT}/research`, { recursive: true });
  appendFileSync(LOG(), `${JSON.stringify(row)}\n`);
  if (row.credits > 0) recordCredits(`grid:${row.category}`, row.credits, new Date(row.at), row.jobId ?? undefined);
}

/** Credits reported by any Firecrawl response shape we have seen. */
export function creditsOf(json: unknown): number {
  const j = (json ?? {}) as Record<string, unknown>;
  const d = (j.data ?? {}) as Record<string, unknown>;
  const meta = (d.metadata ?? {}) as Record<string, unknown>;
  for (const v of [j.creditsUsed, d.creditsUsed, meta.creditsUsed, j.creditsCost, d.creditsCost]) if (typeof v === "number" && Number.isFinite(v)) return v;
  return 0;
}

export type FcResult = { ok: boolean; http: number; json: Record<string, unknown>; credits: number; error: string };

export async function fc(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, category: Category, body?: unknown, opts: { paid?: boolean; fetchImpl?: typeof fetch; timeoutMs?: number } = {}): Promise<FcResult> {
  const key = firecrawlKey();
  if (!key) return { ok: false, http: 0, json: {}, credits: 0, error: "credential missing: FIRECRAWL_API_KEY" };
  if (opts.paid && roundSpent() >= roundBudget()) return { ok: false, http: 0, json: {}, credits: 0, error: `round credit budget reached (${roundBudget()})` };
  const f = opts.fetchImpl ?? fetch;
  let http = 0;
  let json: Record<string, unknown> = {};
  try {
    const r = await f(`${API}/${path}`, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000) });
    http = r.status;
    json = ((await r.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  } catch (e) {
    json = { error: e instanceof Error ? e.message : String(e) };
  }
  const credits = creditsOf(json);
  const ok = http >= 200 && http < 300 && json.success !== false;
  const polled = /^(agent|crawl|batch\/scrape)\/([0-9a-f-]{20,})/.exec(path);
  const jobId = polled ? polled[2] : typeof json.id === "string" ? json.id : typeof (json.data as Record<string, unknown> | undefined)?.id === "string" ? String((json.data as Record<string, unknown>).id) : null;
  const error = ok ? "" : String(json.error ?? json.message ?? (http === 401 ? "credential rejected" : `http ${http}`)).slice(0, 300);
  logCall({ at: new Date().toISOString(), method, path: path.split("?")[0], category, http, ok, credits, jobId, ...(error ? { note: error } : {}) });
  return { ok, http, json, credits, error };
}
