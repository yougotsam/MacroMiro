const UA = "Mozilla/5.0 (compatible; EnvelopeScan/1.0)";
const URL = "https://external-api.kalshi.com/trade-api/v2/margin/markets";
const WANT = new Set(["KXBTCPERP", "KXETHPERP", "KXSOLPERP", "KXXRPPERP", "KXBNBPERP", "KXGOLDPERP", "KXSILVERPERP", "KXUS500PERP"]);

export type PerpQuote = {
  ticker: string;
  asset: string;
  bid: number;
  ask: number;
  contractSize: number;
  lev: number;
  notionalUsd: number;
};

let cache: { at: number; data: PerpQuote[] } | null = null;

function num(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function perpCacheAge(now = Date.now()): number | null {
  return cache ? now - cache.at : null;
}

export async function loadPerps(force = false, maxAgeMs = 8_000): Promise<PerpQuote[]> {
  if (!force && cache && Date.now() - cache.at < maxAgeMs) return cache.data;
  try {
    const res = await fetch(URL, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return cache?.data ?? [];
    const pack = (await res.json()) as {
      markets?: Array<{
        ticker?: string;
        asset_class?: string;
        bid?: string;
        ask?: string;
        contract_size?: string;
        leverage_estimate?: number;
      }>;
    };
    const data: PerpQuote[] = [];
    for (const m of pack.markets ?? []) {
      const ticker = m.ticker ?? "";
      if (!WANT.has(ticker)) continue;
      const bid = num(m.bid);
      const ask = num(m.ask);
      const contractSize = num(m.contract_size);
      data.push({
        ticker,
        asset: m.asset_class ?? "",
        bid,
        ask,
        contractSize,
        lev: num(m.leverage_estimate),
        notionalUsd: Number(((ask || bid) * (contractSize >= 1 ? 1 : 1)).toFixed(4)),
      });
    }
    cache = { at: Date.now(), data };
    return data;
  } catch {
    return cache?.data ?? [];
  }
}
