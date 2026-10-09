/**
 * Alexandria (Firecrawl data-provider exchange) helpers. Discovery is free. Paid execution only through
 * executeApproved(), which needs an explicit approval record and respects a per-round paid-call cap.
 * Provider terms are NEVER accepted here: a THIRD_PARTY_DATA_TERMS_REQUIRED answer is recorded as TERMS_REQUIRED.
 */
export type ProviderStatus = "AVAILABLE" | "TERMS_REQUIRED" | "NOT_ENTITLED" | "UNSUITABLE" | "BROKEN";

export type ToolItem = { id: string; provider: string; capability: string; name?: string; description?: string; creditsCost?: number; perRecord?: boolean };

/** Providers that answer questions this desk actually has (US macro, Fed, rates, gold positioning). */
export const RELEVANT = new Set(["bls-gov", "federalreserve-gov", "cmegroup-com", "treasury-fiscal-data", "fred-stlouisfed-org", "forexfactory-com", "cftc", "cftc-gov"]);

export function classifyProvider(p: { provider: string; findToolsHttp: number; termsRequired: boolean | null; termsAccepted: boolean | null; error?: string }): ProviderStatus {
  if (!RELEVANT.has(p.provider)) return "UNSUITABLE";
  if (p.findToolsHttp === 401 || p.findToolsHttp === 403 || (/not entitled|forbidden|upgrade required/i.test(p.error ?? "") && !/rate limit/i.test(p.error ?? ""))) return "NOT_ENTITLED";
  if (p.findToolsHttp >= 400 || p.findToolsHttp === 0) return "BROKEN";
  if (p.termsRequired && !p.termsAccepted) return "TERMS_REQUIRED";
  return "AVAILABLE";
}

/** Pull tool items out of a find-tools answer; malformed answers give [] rather than throwing. */
export function toolsFrom(json: unknown): ToolItem[] {
  try {
    const items = (json as { alexandria?: { data?: { items?: unknown[] } }[] })?.alexandria?.[0]?.data?.items;
    return Array.isArray(items) ? (items.filter((i) => i && typeof (i as ToolItem).provider === "string" && typeof (i as ToolItem).capability === "string") as ToolItem[]) : [];
  } catch {
    return [];
  }
}

/** Result of one Alexandria execution, with errors surfaced (terms, entitlement, malformed). */
export function readExecution(json: unknown): { ok: boolean; status: ProviderStatus | "OK"; data: unknown; credits: number; error: string; termsUrl?: string } {
  const root = (json ?? {}) as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown>;
  const item = (Array.isArray(data.alexandria) ? data.alexandria[0] : null) as Record<string, unknown> | null;
  const code = String((root.code ?? (item?.error as Record<string, unknown> | undefined)?.code ?? "") as string);
  if (code === "THIRD_PARTY_DATA_TERMS_REQUIRED" || /terms_required/i.test(JSON.stringify(root).slice(0, 2000))) {
    const url = ((root.requiresAction ?? (item?.error as Record<string, unknown> | undefined)?.requiresAction) as { url?: string } | undefined)?.url;
    return { ok: false, status: "TERMS_REQUIRED", data: null, credits: 0, error: "provider terms not accepted (needs Sameer)", termsUrl: url };
  }
  if (!item) return { ok: false, status: "BROKEN", data: null, credits: 0, error: String(root.error ?? "malformed provider response") };
  if (item.error) return { ok: false, status: "BROKEN", data: null, credits: Number(item.creditsCost) || 0, error: String((item.error as { message?: string }).message ?? "provider error") };
  return { ok: true, status: "OK", data: item.data ?? null, credits: Number(item.creditsCost ?? data.creditsCost) || 0, error: "" };
}

export type Approval = { approvedBy: string; reason: string; maxCredits: number; at: string };
export const PAID_CALL_CAP = 3;
export const PAID_CALL_MAX_CREDITS = 50;

/** Guard for a paid Alexandria call. Returns the reason it is refused, or null when it may run. */
export function paidCallRefusal(tool: ToolItem, approval: Approval | null, paidCallsSoFar: number): string | null {
  if (!approval) return "no approval record";
  if (paidCallsSoFar >= PAID_CALL_CAP) return `paid-call cap reached (${PAID_CALL_CAP})`;
  const cost = Number(tool.creditsCost);
  if (!Number.isFinite(cost)) return "unknown price";
  if (cost > Math.min(approval.maxCredits, PAID_CALL_MAX_CREDITS)) return `price ${cost} over approved max`;
  return null;
}

/** Agent body that may use Alexandria providers but stops before ANY paid provider call (pendingApproval). */
export function agentExchangeBody(prompt: string, toolkits: string[], maxCredits: number) {
  return {
    prompt,
    model: "spark-2",
    effort: "low",
    maxCredits,
    mode: "chat",
    exchange: { enabled: true, toolkits: toolkits.slice(0, 5), maxCalls: 3, requireApproval: true, onTermsRequired: "skip" },
  };
}
