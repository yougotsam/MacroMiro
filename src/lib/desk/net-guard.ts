/**
 * Process-wide read-only network guard for the observation collector and the recovery tool.
 * After install, any fetch whose method is not GET/HEAD throws BEFORE a request leaves the process, and the
 * order-entry paths are refused even for GET-shaped calls with a body. Counts refusals for the status file.
 */
export type GuardStats = { allowed: number; refused: number; lastRefused: string | null };

const ORDER_WRITE = /\/portfolio\/(?:events\/)?orders(?:\/|$|\?)/;

export function installReadOnlyFetch(): GuardStats {
  const g = globalThis as unknown as { fetch: typeof fetch; __deskReadOnly?: GuardStats };
  if (g.__deskReadOnly) return g.__deskReadOnly;
  const stats: GuardStats = { allowed: 0, refused: 0, lastRefused: null };
  const real = g.fetch.bind(globalThis);
  const guarded = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = String(init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if ((method !== "GET" && method !== "HEAD") || (init?.body != null && ORDER_WRITE.test(url))) {
      stats.refused += 1;
      stats.lastRefused = `${method} ${url.split("?")[0]}`;
      throw new Error(`read-only process: ${method} refused`);
    }
    stats.allowed += 1;
    return real(input, init);
  }) as typeof fetch;
  g.fetch = guarded;
  g.__deskReadOnly = stats;
  return stats;
}
