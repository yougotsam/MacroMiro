import { loadDesk } from "@/lib/live/server";
import { CLIP_USD } from "@/lib/envelope/clip";
import { loadDexTape } from "./dex";
import { loadKalshiBooks } from "./kalshi";
import { loadPolyUs } from "./polyus";
import { telegramReady } from "./telegram";
import { runGraph, type BinanceTick, type PolyMarket } from "./graph";
import type { ScanPayload } from "./types";

const UA = "Mozilla/5.0 (compatible; EnvelopeScan/1.0)";
let cache: { at: number; data: ScanPayload } | null = null;
const TTL = 50_000;

async function grabJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function prices(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.map(Number) : [];
    } catch {
      return [];
    }
  }
  return [];
}

type GammaEvent = {
  title?: string;
  endDate?: string;
  markets?: {
    question?: string;
    outcomePrices?: unknown;
    spread?: number;
    bestBid?: number;
    bestAsk?: number;
    endDate?: string;
  }[];
};

async function polymarket(): Promise<PolyMarket[]> {
  const qs = ["Bitcoin above", "FOMC", "CPI", "BTC 15m", "Bitcoin Up or Down", "gold", "crude oil", "S&P"];
  const packs = await Promise.all(
    qs.map((q) =>
      grabJson<{ events?: GammaEvent[] }>(
        `https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent(q)}&limit_per_type=6`,
      ),
    ),
  );
  const out: PolyMarket[] = [];
  const seen = new Set<string>();
  for (const pack of packs) {
    for (const ev of pack?.events ?? []) {
      for (const m of ev.markets ?? []) {
        const q = (m.question || ev.title || "").trim();
        if (!q || seen.has(q)) continue;
        const px = prices(m.outcomePrices);
        const yes = px[0];
        if (!Number.isFinite(yes) || yes <= 0.05 || yes >= 0.95) continue;
        seen.add(q);
        const spread = Number(m.spread) || Math.max(0, (Number(m.bestAsk) || yes) - (Number(m.bestBid) || yes));
        out.push({
          question: q.slice(0, 88),
          yes,
          spread,
          bid: m.bestBid ?? null,
          ask: m.bestAsk ?? null,
          end: m.endDate ?? ev.endDate ?? null,
        });
      }
    }
  }
  return out.slice(0, 24);
}

async function binance(): Promise<BinanceTick[]> {
  const packed = await grabJson<
    { symbol: string; lastPrice: string; priceChangePercent: string; bidPrice: string; askPrice: string }[]
  >(
    "https://data-api.binance.vision/api/v3/ticker/24hr?symbols=%5B%22BTCUSDT%22,%22ETHUSDT%22,%22SOLUSDT%22%5D",
  );
  if (Array.isArray(packed) && packed.length) {
    return packed.map((t) => ({
      symbol: t.symbol,
      last: Number(t.lastPrice),
      changePct: Number(t.priceChangePercent),
      bid: Number(t.bidPrice),
      ask: Number(t.askPrice),
    }));
  }
  const out: BinanceTick[] = [];
  for (const symbol of ["BTCUSDT", "ETHUSDT", "SOLUSDT"]) {
    const t = await grabJson<{
      symbol: string;
      lastPrice: string;
      priceChangePercent: string;
      bidPrice: string;
      askPrice: string;
    }>(`https://api.binance.us/api/v3/ticker/24hr?symbol=${symbol}`);
    if (!t?.lastPrice) continue;
    out.push({
      symbol: t.symbol || symbol,
      last: Number(t.lastPrice),
      changePct: Number(t.priceChangePercent),
      bid: Number(t.bidPrice),
      ask: Number(t.askPrice),
    });
  }
  return out;
}

export function bustScanCache() {
  cache = null;
}

export async function loadScan(force = false): Promise<ScanPayload> {
  if (!force && cache && Date.now() - cache.at < TTL) return cache.data;
  const [desk, poly, polyUs, bn, dex, books] = await Promise.all([
    loadDesk(force),
    polymarket(),
    loadPolyUs(),
    binance(),
    loadDexTape(force),
    loadKalshiBooks(force),
  ]);
  const data = runGraph({
    desk,
    poly,
    polyUs,
    binance: bn,
    dex,
    cash: 300,
    tg: { ready: telegramReady(), last: "Ping Zeebs only" },
  });
  for (const k of [...books].reverse()) {
    data.rows.unshift({
      id: `kalshi15m-${k.ticker || k.slug}`,
      ts: new Date().toISOString(),
      venue: "kalshi",
      action: k.take ? "scan" : "watch",
      market: k.question,
      price: k.leg === "down" ? k.down : k.up,
      sizeUsd: k.take ? CLIP_USD : 0,
      note: `${k.leftSec}s · beat ${k.beat.toFixed(2)} spot ${k.spot.toFixed(2)} · ${k.reason} · ${k.ticker || k.slug}`,
      url: k.url,
    });
  }
  cache = { at: Date.now(), data };
  return data;
}
