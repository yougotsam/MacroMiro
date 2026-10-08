/** Read-only Kalshi Trade API calls used by the engine (GET only). */
import { kalshiGet } from "@/lib/scan/kalshi-auth";
import { DAILY_STOP_USD, SERIES, TICKER_RE } from "./config";
import { quadraticFee } from "./fees";
import type { Book } from "./gate";
import type { AccountSnapshot, Settled } from "./risk";
import { etDay, etDayStart } from "./time";

const PUB = "https://api.elections.kalshi.com/trade-api/v2";

async function pub<T>(path: string, timeoutMs = 4_000): Promise<T> {
  const res = await fetch(`${PUB}${path}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GET ${path} ${res.status}`);
  return (await res.json()) as T;
}

export type Market = {
  ticker: string;
  series: string;
  openMs: number;
  closeMs: number;
  strike: number;
  status: string;
  exchangeIndex: number;
  strikeType: string;
  rules: string;
};

export async function openMarket(series: string): Promise<Market | null> {
  const d = await pub<{ markets?: Array<Record<string, unknown>> }>(`/markets?series_ticker=${series}&status=open&limit=5`);
  const now = Date.now();
  const ms = (d.markets ?? [])
    .map((m) => ({
      ticker: String(m.ticker),
      series,
      openMs: Date.parse(String(m.open_time)),
      closeMs: Date.parse(String(m.close_time)),
      strike: Number(m.floor_strike),
      status: String(m.status),
      exchangeIndex: Number(m.exchange_index ?? 2),
      strikeType: String(m.strike_type ?? ""),
      rules: String(m.rules_primary ?? ""),
    }))
    .filter((m) => m.openMs <= now && m.closeMs > now && Number.isFinite(m.strike) && m.strike > 0)
    .sort((a, b) => a.closeMs - b.closeMs);
  return ms[0] ?? null;
}

export async function orderbook(ticker: string): Promise<Book> {
  const d = await pub<{ orderbook_fp?: { yes_dollars?: [string, string][]; no_dollars?: [string, string][] } }>(`/markets/${ticker}/orderbook?depth=10`, 2_500);
  const ts = Date.now();
  const top = (arr?: [string, string][]) => {
    if (!arr || !arr.length) return null;
    const [p, s] = arr[arr.length - 1]; // ascending; best bid is last
    const price = Number(p);
    const size = Number(s);
    return price > 0 && size > 0 ? { price, size } : null;
  };
  return { yesBid: top(d.orderbook_fp?.yes_dollars), noBid: top(d.orderbook_fp?.no_dollars), ts };
}

export async function exchangeStatus(): Promise<{ tradingActive: boolean; shard2: boolean; raw: unknown }> {
  const d = await pub<{ trading_active?: boolean; exchange_active?: boolean; exchange_index_statuses?: Array<{ exchange_index: number; trading_active: boolean; exchange_active: boolean }> }>(`/exchange/status`);
  const s2 = d.exchange_index_statuses?.find((x) => x.exchange_index === 2);
  const shard2 = s2 ? s2.trading_active && s2.exchange_active : Boolean(d.trading_active && d.exchange_active);
  return { tradingActive: Boolean(d.exchange_active) && shard2, shard2, raw: d };
}

export async function seriesFee(series: string) {
  const d = await pub<{ series?: { fee_type?: string; fee_multiplier?: number } }>(`/series/${series}`);
  return { feeType: String(d.series?.fee_type ?? "unknown"), multiplier: Number(d.series?.fee_multiplier ?? 1) };
}

export async function marketResult(ticker: string): Promise<{ result: string; value: number | null; status: string } | null> {
  const d = await pub<{ market?: { result?: string; expiration_value?: string; status?: string } }>(`/markets/${ticker}`);
  if (!d.market) return null;
  const v = Number(d.market.expiration_value);
  return { result: String(d.market.result ?? ""), value: Number.isFinite(v) && d.market.expiration_value ? v : null, status: String(d.market.status ?? "") };
}

async function pages<T>(base: string, field: string, max = 10): Promise<T[]> {
  const out: T[] = [];
  let cursor = "";
  for (let i = 0; i < max; i += 1) {
    const p = `${base}${base.includes("?") ? "&" : "?"}limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const { data } = await kalshiGet<Record<string, unknown>>(p);
    out.push(...(((data[field] as T[]) ?? []) as T[]));
    cursor = String(data.cursor ?? "");
    if (!cursor) break;
  }
  return out;
}

export type KOrder = {
  order_id: string;
  client_order_id?: string;
  ticker: string;
  status: string;
  side?: string;
  outcome_side?: string;
  book_side?: string;
  yes_price_dollars?: string;
  no_price_dollars?: string;
  remaining_count_fp?: string;
  fill_count_fp?: string;
  created_time?: string;
};

export async function ordersByClientIds(ids: string[]): Promise<KOrder[]> {
  if (!ids.length) return [];
  const { data } = await kalshiGet<{ orders?: KOrder[] }>(`/trade-api/v2/portfolio/orders?client_order_ids=${encodeURIComponent(ids.join(","))}`);
  return data.orders ?? [];
}

export async function restingOrders(): Promise<KOrder[]> {
  return pages<KOrder>("/trade-api/v2/portfolio/orders?status=resting", "orders", 5);
}

export async function ordersSince(minTsSec: number): Promise<KOrder[]> {
  return pages<KOrder>(`/trade-api/v2/portfolio/orders?min_ts=${minTsSec}`, "orders", 10);
}

const desk = (t: string) => TICKER_RE.test(t);
const SERIES_SET = new Set<string>(SERIES);

export function sidePrice(o: KOrder) {
  const side = (o.outcome_side ?? o.side ?? "yes").toLowerCase();
  return side === "no" ? Number(o.no_price_dollars ?? 0) : Number(o.yes_price_dollars ?? 0);
}

/** Pure: build the risk snapshot from raw Kalshi records (unit-tested). */
export function buildSnapshot(input: {
  now: number;
  settlements: Array<{ ticker: string; settled_time: string; revenue: number; yes_total_cost_dollars?: string; no_total_cost_dollars?: string; fee_cost?: string }>;
  positions: Array<{ ticker: string; position_fp?: string; market_exposure_dollars?: string; fees_paid_dollars?: string }>;
  resting: KOrder[];
  ordersToday: KOrder[];
  shard2Cash: number;
  exchangeTradingActive: boolean;
  exchangeCheckedAt: number;
  pendingWorst?: number;
  localOrdersPerTicker?: Record<string, number>;
}): AccountSnapshot {
  const start = etDayStart(input.now);
  const settledToday: Settled[] = [];
  let realized = 0;
  for (const s of input.settlements) {
    if (!desk(s.ticker)) continue;
    const ms = Date.parse(s.settled_time);
    if (!(ms >= start)) continue;
    const pnl = s.revenue / 100 - Number(s.yes_total_cost_dollars ?? 0) - Number(s.no_total_cost_dollars ?? 0) - Number(s.fee_cost ?? 0);
    realized += pnl;
    settledToday.push({ ticker: s.ticker, pnl, settledMs: ms });
  }
  let openWorst = 0;
  for (const p of input.positions) {
    if (!desk(p.ticker)) continue;
    if (Math.abs(Number(p.position_fp ?? 0)) < 1e-9) continue;
    openWorst += Math.abs(Number(p.market_exposure_dollars ?? 0)) + Number(p.fees_paid_dollars ?? 0);
  }
  let restWorst = 0;
  for (const o of input.resting) {
    if (!desk(o.ticker)) continue;
    const left = Number(o.remaining_count_fp ?? 0);
    const px = sidePrice(o);
    restWorst += left * px + quadraticFee(left, px);
  }
  const ordersPerTicker: Record<string, number> = {};
  for (const o of input.ordersToday) {
    if (!desk(o.ticker) || !(o.client_order_id ?? "").startsWith("mm1-")) continue;
    ordersPerTicker[o.ticker] = (ordersPerTicker[o.ticker] ?? 0) + 1;
  }
  for (const [t, n] of Object.entries(input.localOrdersPerTicker ?? {})) ordersPerTicker[t] = Math.max(ordersPerTicker[t] ?? 0, n);
  return {
    fetchedAt: input.now,
    etDay: etDay(input.now),
    realizedToday: Number(realized.toFixed(4)),
    openWorst: Number(openWorst.toFixed(4)),
    restWorst: Number(restWorst.toFixed(4)),
    pendingWorst: Number((input.pendingWorst ?? 0).toFixed(4)),
    shard2Cash: input.shard2Cash,
    settledToday,
    ordersPerTicker,
    exchangeTradingActive: input.exchangeTradingActive,
    exchangeCheckedAt: input.exchangeCheckedAt,
  };
}

/** Live: the account's truth from Kalshi (settlements, positions, resting orders, today's orders, shard-2 cash). */
export type Position = { ticker: string; position_fp?: string; market_exposure_dollars?: string; fees_paid_dollars?: string };

export async function fetchSnapshot(ex: { tradingActive: boolean; at: number }, local: { pendingWorst: number; perTicker: Record<string, number> }): Promise<{ snap: AccountSnapshot; resting: KOrder[]; positions: Position[] }> {
  const now = Date.now();
  const start = etDayStart(now);
  const minTs = Math.floor(start / 1000) - 3600;
  const [settlements, positions, resting, ordersToday, bal] = await Promise.all([
    pages<{ ticker: string; settled_time: string; revenue: number; yes_total_cost_dollars?: string; no_total_cost_dollars?: string; fee_cost?: string }>(`/trade-api/v2/portfolio/settlements?min_ts=${minTs}`, "settlements", 5),
    pages<Position>(`/trade-api/v2/portfolio/positions?count_filter=position`, "market_positions", 5),
    restingOrders(),
    ordersSince(minTs),
    kalshiGet<{ balance_breakdown?: Array<{ balance?: string; exchange_index?: number }> }>("/trade-api/v2/portfolio/balance"),
  ]);
  const shard2Cash = Number(bal.data.balance_breakdown?.find((b) => b.exchange_index === 2)?.balance ?? 0);
  void SERIES_SET;
  void DAILY_STOP_USD;
  const snap = buildSnapshot({
    now,
    settlements,
    positions,
    resting,
    ordersToday,
    shard2Cash,
    exchangeTradingActive: ex.tradingActive,
    exchangeCheckedAt: ex.at,
    pendingWorst: local.pendingWorst,
    localOrdersPerTicker: local.perTicker,
  });
  return { snap, resting: resting.filter((o) => desk(o.ticker)), positions: positions.filter((p) => desk(p.ticker) && Math.abs(Number(p.position_fp ?? 0)) > 1e-9) };
}
