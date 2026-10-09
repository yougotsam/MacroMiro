/**
 * Compute-budget accounting for the research swarm (MiroFish). Pure functions + a tiny ledger format.
 * Prices are list prices per 1M tokens (Gemini 3.8 Flash introductory, verified on ai.google.dev 2026-10-09);
 * a free-tier key may cost $0 — the ledger reports LIST-PRICE cost, never less.
 */
export type Price = { inPerM: number; outPerM: number; source: string };
export const PRICES: Record<string, Price> = {
  "gemini-3.8-flash": { inPerM: 0.75, outPerM: 3.75, source: "https://ai.google.dev/gemini-api/docs/pricing (intro rate to 2026-12-31)" },
};
export const ALLOWED_UPSTREAMS = new Set(["generativelanguage.googleapis.com", "api.x.ai"]);

export type Usage = { prompt: number; completion: number };
export type LedgerEntry = { ts: string; tag: string; model: string; status: number; prompt: number; completion: number; estimated: boolean; costUsd: number };

export function costOf(model: string, u: Usage) {
  const p = PRICES[model] ?? PRICES["gemini-3.8-flash"];
  return (u.prompt * p.inPerM + u.completion * p.outPerM) / 1e6;
}

/** usage from a JSON body or the last SSE chunk that carries one; null when the provider did not report it */
export function usageFrom(body: string): Usage | null {
  const pick = (j: unknown): Usage | null => {
    const u = (j as { usage?: { prompt_tokens?: number; completion_tokens?: number } } | null)?.usage;
    return u && typeof u.prompt_tokens === "number" ? { prompt: u.prompt_tokens, completion: u.completion_tokens ?? 0 } : null;
  };
  try {
    return pick(JSON.parse(body));
  } catch {
    let last: Usage | null = null;
    for (const line of body.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        last = pick(JSON.parse(line.slice(5).trim())) ?? last;
      } catch { /* [DONE] or partial */ }
    }
    return last;
  }
}

/** conservative fallback when usage is missing: ~4 chars per token on both sides */
export function estimateUsage(reqBody: string, resBody: string): Usage {
  return { prompt: Math.ceil(reqBody.length / 4), completion: Math.ceil(resBody.length / 4) };
}

/** split "/<host>/<path>" into an allow-listed upstream URL, or null */
export function upstreamOf(path: string): string | null {
  const m = path.match(/^\/([a-z0-9.-]+)(\/.*)?$/i);
  if (!m || !ALLOWED_UPSTREAMS.has(m[1].toLowerCase())) return null;
  return `https://${m[1].toLowerCase()}${m[2] ?? "/"}`;
}

export function spent(entries: LedgerEntry[], tag?: string) {
  return entries.filter((e) => !tag || e.tag === tag).reduce((a, e) => a + e.costUsd, 0);
}
