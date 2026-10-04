import { readFileSync } from "node:fs";

export type DexPair = {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  base: string;
  quote: string;
  priceUsd: number;
  liqUsd: number;
  vol24: number;
  chg5m: number | null;
  chg1h: number | null;
  boosted: boolean;
  fresh: boolean;
};

export type DexTape = {
  asOf: string;
  pairs: DexPair[];
  boostN: number;
  profileN: number;
  solUsd: number | null;
  jupUsd: number | null;
  jupOut: number | null;
  err: string | null;
  jupReady: boolean;
};

const UA = "Mozilla/5.0 (compatible; EnvelopeScan/1.0)";
const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const RAYDIUM_SOL_USDC = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2";

let cache: { at: number; data: DexTape } | null = null;
const TTL = 45_000;

function jupKey() {
  const env = (process.env.JUPITER_API_KEY ?? "").trim();
  if (env.startsWith("jup_")) return env;
  try {
    const disk = readFileSync("/workspace/.grok/secrets/jup", "utf8").trim();
    if (disk.startsWith("jup_")) {
      process.env.JUPITER_API_KEY = disk;
      return disk;
    }
  } catch {
    /* missing */
  }
  return "";
}

async function grabJson<T>(url: string, headers: Record<string, string> = {}): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, ...headers },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

type RawPair = {
  chainId?: string;
  dexId?: string;
  url?: string;
  pairAddress?: string;
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  priceChange?: { m5?: number; h1?: number };
  baseToken?: { symbol?: string; address?: string };
  quoteToken?: { symbol?: string };
};

function asPair(p: RawPair, extra: { boosted?: boolean; fresh?: boolean } = {}): DexPair | null {
  const px = Number(p.priceUsd);
  if (!Number.isFinite(px) || px <= 0) return null;
  return {
    chainId: p.chainId || "",
    dexId: p.dexId || "",
    url: p.url || "",
    pairAddress: p.pairAddress || "",
    base: p.baseToken?.symbol || "?",
    quote: p.quoteToken?.symbol || "?",
    priceUsd: px,
    liqUsd: Number(p.liquidity?.usd) || 0,
    vol24: Number(p.volume?.h24) || 0,
    chg5m: p.priceChange?.m5 ?? null,
    chg1h: p.priceChange?.h1 ?? null,
    boosted: Boolean(extra.boosted),
    fresh: Boolean(extra.fresh),
  };
}

async function jupQuote() {
  const key = jupKey();
  const qs = `inputMint=${SOL}&outputMint=${USDC}&amount=1000000000&slippageBps=50`;
  if (key) {
    const hit = await grabJson<{ outAmount?: string; inAmount?: string }>(`https://api.jup.ag/swap/v1/quote?${qs}`, {
      "x-api-key": key,
    });
    if (hit?.outAmount) return hit;
  }
  return grabJson<{ outAmount?: string; inAmount?: string }>(`https://lite-api.jup.ag/swap/v1/quote?${qs}`);
}

export async function loadDexTape(force = false): Promise<DexTape> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.data;

  const [pair, boosts] = await Promise.all([
    grabJson<{ pairs?: RawPair[] }>(`https://api.dexscreener.com/latest/dex/pairs/solana/${RAYDIUM_SOL_USDC}`),
    grabJson<{ chainId?: string; tokenAddress?: string; url?: string; description?: string }[]>(
      "https://api.dexscreener.com/token-boosts/top/v1",
    ),
  ]);
  const profiles = pair
    ? await grabJson<{ chainId?: string; tokenAddress?: string; url?: string; description?: string }[]>(
        "https://api.dexscreener.com/token-profiles/latest/v1",
      )
    : null;
  const quote = await jupQuote();

  const boosted = new Set(
    (boosts ?? []).filter((b) => b.chainId === "solana").map((b) => (b.tokenAddress || "").toLowerCase()),
  );

  const byAddr = new Map<string, DexPair>();
  const ingest = (raw: RawPair[] | undefined, extra: { boosted?: boolean; fresh?: boolean }) => {
    for (const p of raw ?? []) {
      if (p.chainId && p.chainId !== "solana") continue;
      const row = asPair(p, extra);
      if (!row) continue;
      const key = row.pairAddress || `${row.base}-${row.url}`;
      const hit = boosted.has((p.baseToken?.address || "").toLowerCase());
      if (hit) row.boosted = true;
      const prev = byAddr.get(key);
      if (!prev || row.liqUsd > prev.liqUsd) byAddr.set(key, row);
    }
  };
  ingest(pair?.pairs, {});

  const pairs = [...byAddr.values()].sort((a, b) => b.liqUsd - a.liqUsd).slice(0, 12);
  const sol = pairs.find((p) => p.base === "SOL" && (p.quote === "USDC" || p.quote === "USDT"));
  const jupOut = quote?.outAmount ? Number(quote.outAmount) / 1e6 : null;

  const solProfiles = (profiles ?? []).filter((p) => p.chainId === "solana").slice(0, 6);
  for (const p of solProfiles) {
    pairs.push({
      chainId: "solana",
      dexId: "profile",
      url: p.url || `https://dexscreener.com/solana/${p.tokenAddress}`,
      pairAddress: p.tokenAddress || "",
      base: (p.description || "new").slice(0, 24),
      quote: "SOL",
      priceUsd: 0,
      liqUsd: 0,
      vol24: 0,
      chg5m: null,
      chg1h: null,
      boosted: boosted.has((p.tokenAddress || "").toLowerCase()),
      fresh: true,
    });
  }

  const jupReady = Boolean(jupKey());
  const err =
    !pair && !boosts
      ? "DexScreener 429/down"
      : quote
        ? null
        : jupReady
          ? "Jupiter quote refused. Dex last still live."
          : "Jupiter key missing. Dex last still live.";

  const data: DexTape = {
    asOf: new Date().toISOString(),
    pairs,
    boostN: boosted.size,
    profileN: solProfiles.length,
    solUsd: sol?.priceUsd ?? null,
    jupUsd: Number.isFinite(jupOut) ? jupOut : null,
    jupOut,
    err,
    jupReady,
  };
  cache = { at: Date.now(), data };
  return data;
}
