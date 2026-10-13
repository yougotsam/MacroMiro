/**
 * Kalshi perpetuals (margin) market-data adapter — READ-ONLY. Every call is a signed GET; there is no POST,
 * DELETE or amend in this file (enforced by test). Timestamps from the venue are kept as epoch ms.
 * Docs: https://docs.kalshi.com/margin (REST under /trade-api/v2/margin).
 */
import { kalshiSignedHeaders } from "@/lib/scan/kalshi-auth";

export const PERPS_HOST = process.env.KALSHI_PERPS_HOST || "https://external-api.kalshi.com";
const BASE = "/trade-api/v2/margin";
type Get = (path: string) => Promise<unknown>;

export const signedGet: Get = async (path) => {
  const full = `${BASE}${path}`;
  const res = await fetch(`${PERPS_HOST}${full}`, { method: "GET", headers: kalshiSignedHeaders("GET", full), signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`GET ${full.split("?")[0]} ${res.status}`);
  return res.json();
};

const num = (x: unknown) => (x == null || x === "" ? null : Number.isFinite(Number(x)) ? Number(x) : null);

export type PerpMarket = {
  ticker: string; title: string; assetClass: string; status: string; bid: number | null; ask: number | null; last: number | null;
  contractSize: number; tick: number; leverageEstimate: number | null; openInterestUsd: number | null; volume24hUsd: number | null;
  markPrice: number | null; markTsMs: number | null; referencePrice: number | null; referenceTsMs: number | null; exchangeIndex: number | null;
};
export function parseMarket(m: Record<string, any>): PerpMarket {
  return {
    ticker: String(m.ticker), title: String(m.title ?? ""), assetClass: String(m.asset_class ?? ""), status: String(m.status ?? ""),
    bid: num(m.bid), ask: num(m.ask), last: num(m.price), contractSize: Number(m.contract_size), tick: num(m.tick_size) ?? 0.0001,
    leverageEstimate: num(m.leverage_estimate), openInterestUsd: num(m.open_interest_notional_value_dollars), volume24hUsd: num(m.volume_24h_notional_value_dollars),
    markPrice: num(m.settlement_mark_price?.price), markTsMs: num(m.settlement_mark_price?.ts_ms), referencePrice: num(m.reference_price?.price), referenceTsMs: num(m.reference_price?.ts_ms), exchangeIndex: num(m.exchange_index),
  };
}

export type Book = { bids: [number, number][]; asks: [number, number][]; bestBid: number | null; bestAsk: number | null };
/** Kalshi returns each side sorted ascending; best bid = highest bid, best ask = lowest ask. */
export function parseBook(raw: { orderbook?: { bids?: string[][]; asks?: string[][] } }): Book {
  const side = (s?: string[][]) => (s ?? []).map((x) => [Number(x[0]), Number(x[1])] as [number, number]).filter((x) => x.every(Number.isFinite));
  const bids = side(raw.orderbook?.bids).sort((a, b) => b[0] - a[0]);
  const asks = side(raw.orderbook?.asks).sort((a, b) => a[0] - b[0]);
  return { bids, asks, bestBid: bids[0]?.[0] ?? null, bestAsk: asks[0]?.[0] ?? null };
}

export type PerpCandle = { t: number; o: number; h: number; l: number; c: number; v: number };
export function parseCandles(raw: { candlesticks?: Array<Record<string, any>> }, periodMin: number): PerpCandle[] {
  return (raw.candlesticks ?? []).map((k) => ({ t: (Number(k.end_period_ts) - periodMin * 60) * 1000, o: Number(k.price?.open), h: Number(k.price?.high), l: Number(k.price?.low), c: Number(k.price?.close), v: Number(k.volume) }))
    .filter((k) => [k.o, k.h, k.l, k.c].every(Number.isFinite));
}

export function perpsReader(get: Get = signedGet) {
  return {
    enabled: async () => Boolean(((await get("/enabled")) as { enabled?: boolean }).enabled),
    exchangeStatus: async () => (await get("/exchange/status")) as { exchange_active: boolean; trading_active: boolean },
    markets: async () => (((await get("/markets?limit=200")) as { markets: Record<string, any>[] }).markets ?? []).map(parseMarket),
    market: async (t: string) => parseMarket(((await get(`/markets/${t}`)) as { market: Record<string, any> }).market),
    book: async (t: string, depth = 25) => parseBook((await get(`/markets/${t}/orderbook?depth=${depth}`)) as never),
    trades: async (t: string, limit = 100) => ((await get(`/trades?ticker=${t}&limit=${limit}`)) as { trades: Array<{ price: string; count: string; taker_side: string; created_time: string }> }).trades ?? [],
    candles: async (t: string, periodMin: 1 | 60 | 1440, startS: number, endS: number) => parseCandles((await get(`/markets/${t}/candlesticks?start_ts=${startS}&end_ts=${endS}&period_interval=${periodMin}`)) as never, periodMin),
    fundingEstimate: async (t: string) => {
      const d = (await get(`/funding_rates/estimate?ticker=${t}`)) as { funding_rate: number; next_funding_time: string; mark_price: string; computed_time: string };
      return { rate: Number(d.funding_rate), nextMs: Date.parse(d.next_funding_time), mark: Number(d.mark_price), computedMs: Date.parse(d.computed_time) };
    },
    fundingHistory: async (t: string, startS: number, endS: number) => ((await get(`/funding_rates/historical?ticker=${t}&start_ts=${startS}&end_ts=${endS}`)) as { funding_rates: Array<{ funding_rate: number; funding_time: string }> }).funding_rates ?? [],
    feeTiers: async () => (await get("/fee_tiers")) as { maker_fee_rates: Record<string, number>; taker_fee_rates: Record<string, number> },
    riskParameters: async () => (await get("/risk_parameters")) as Record<string, unknown>,
    balance: async () => (await get("/balance")) as Record<string, unknown>,
  };
}

/** Price band (docs.kalshi.com/margin/price-banding): bids ≥ min(0.8·bestBid, bestBid − 1000 ticks); asks ≤ max(1.2·bestAsk, bestAsk + 1000 ticks). */
export function priceBand(book: Book, tick = 0.0001) {
  return {
    minBid: book.bestBid == null ? null : Math.min(0.8 * book.bestBid, book.bestBid - 1000 * tick),
    maxAsk: book.bestAsk == null ? null : Math.max(1.2 * book.bestAsk, book.bestAsk + 1000 * tick),
  };
}
