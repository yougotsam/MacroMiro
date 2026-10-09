/** Read-only Kalshi Trade API calls used by the engine (GET only). */
import { kalshiGet } from "@/lib/scan/kalshi-auth";
import { DAILY_STOP_USD, SERIES, TICKER_RE } from "./config";
import { correlationKey } from "./exposure";
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
  eventTicker: string;
  openMs: number;
  closeMs: number;
  strike: number;
  status: string;
  exchangeIndex: number;
  strikeType: string;
  rules: string;
  priceRanges: Array<{ start: number; end: number; step: number }>;
};

export async function openMarket(series: string): Promise<Market | null> {
  const d = await pub<{ markets?: Array<Record<string, unknown>> }>(`/markets?series_ticker=${series}&status=open&limit=5`);
  const now = Date.now();
  const ms = (d.markets ?? [])
    .map((m) => ({
      ticker: String(m.ticker),
      eventTicker: String(m.event_ticker ?? ""),
      series,
      openMs: Date.parse(String(m.open_time)),
      closeMs: Date.parse(String(m.close_time)),
      strike: Number(m.floor_strike),
      status: String(m.status),
      exchangeIndex: Number(m.exchange_index),
      strikeType: String(m.strike_type ?? ""),
      rules: String(m.rules_primary ?? ""),
      priceRanges: (Array.isArray(m.price_ranges) ? m.price_ranges : []).map((range) => {
        const p = range as Record<string, unknown>;
        return { start: Number(p.start), end: Number(p.end), step: Number(p.step) };
      }).filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end) &&
          Number.isFinite(p.step) && p.step > 0 && p.end > p.start),
    }))
    .filter((m) => m.openMs <= now && m.closeMs > now && Number.isFinite(m.strike) &&
      m.strike > 0 && m.eventTicker.length > 0 && m.exchangeIndex === 2 && m.priceRanges.length > 0)
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
  const feeType = String(d.series?.fee_type ?? "unknown");
  const multiplier = Number(d.series?.fee_multiplier);
  if (feeType !== "quadratic" || !Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error("unsupported or incomplete fee specification");
  }
  return { feeType, multiplier };
}

/**
 * Resolve the actual event fee before an executable decision. Kalshi permits
 * event-specific fee overrides; a series-only rate can be wrong.
 * Any unsupported/unreadable fee structure refuses trading, rather than undercharging.
 */
export async function eventFee(series: string, eventTicker: string): Promise<{ feeType: string; multiplier: number }> {
  if (!/^[A-Za-z0-9-]+$/.test(eventTicker)) throw new Error("invalid event ticker");
  const [base, response] = await Promise.all([
    seriesFee(series),
    pub<{ event?: { fee_type_override?: string | null; fee_multiplier_override?: number | null } }>(
      `/events/${encodeURIComponent(eventTicker)}`, 2_500,
    ),
  ]);
  if (!response.event) throw new Error("event fee source missing");
  const feeType = response.event.fee_type_override ?? base.feeType;
  const multiplier = response.event.fee_multiplier_override ?? base.multiplier;
  if (feeType !== "quadratic" || !Number.isFinite(multiplier) || multiplier <= 0) {
    throw new Error("unsupported event fee override");
  }
  return { feeType, multiplier };
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
  taker_fees_dollars?: string;
  maker_fees_dollars?: string;
};

export { correlationKey };

/** Ticker inside a desk client_order_id "mm1-<ticker>-<y|n>-<seq>". */
export function tickerOfCid(cid: string) {
  const m = /^mm1-(.+)-[yn]-\d+$/.exec(cid);
  return m ? m[1] : null;
}

/**
 * Orders by client_order_id. Kalshi ignores a client_order_ids filter on GET /portfolio/orders (verified live
 * 2026-10-08: it returns every order), so query per ticker and match the id exactly here.
 */
export async function ordersByClientIds(ids: string[]): Promise<KOrder[]> {
  if (!ids.length) return [];
  const want = new Set(ids);
  const tickers = [...new Set(ids.map(tickerOfCid).filter((t): t is string => Boolean(t)))];
  const out: KOrder[] = [];
  for (const t of tickers) {
    const rows = await pages<KOrder>(`/trade-api/v2/portfolio/orders?ticker=${encodeURIComponent(t)}`, "orders", 3);
    for (const o of rows) if (o.client_order_id && want.has(o.client_order_id)) out.push(o);
  }
  return out;
}

export async function restingOrders(): Promise<KOrder[]> {
  return pages<KOrder>("/trade-api/v2/portfolio/orders?status=resting", "orders", 5);
}

export async function ordersSince(minTsSec: number): Promise<KOrder[]> {
  return pages<KOrder>(`/trade-api/v2/portfolio/orders?min_ts=${minTsSec}`, "orders", 10);
}

const desk = (t: string) => TICKER_RE.test(t);
const SERIES_SET = new Set<string>(SERIES);

/** Missing or malformed exchange finance fields must not be treated as zero exposure. */
function finiteAmount(raw: unknown, field: string, allowMissing = false): number {
  if (raw == null || raw === "") {
    if (allowMissing) return 0;
    throw new Error(`missing ${field}`);
  }
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid ${field}`);
  return n;
}

/** Which contract an order buys. Desk V2 BUY YES is "bid", BUY NO is "ask"; an explicit outcome_side/book_side wins. */
export function orderOutcomeSide(o: KOrder): "yes" | "no" | null {
  const sideRaw = o.outcome_side ?? o.book_side ??
    (o.side === "bid" ? "yes" : o.side === "ask" ? "no" : o.side);
  const side = String(sideRaw ?? "").toLowerCase();
  return side === "yes" || side === "no" ? side : null;
}

export function sidePrice(o: KOrder) {
  const side = orderOutcomeSide(o);
  if (side == null) throw new Error("unknown order outcome_side");
  const raw = side === "no" ? o.no_price_dollars : o.yes_price_dollars;
  const price = finiteAmount(raw, "order price");
  if (!(price > 0 && price < 1)) throw new Error("invalid order price range");
  return price;
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
  /** OMS sends (persisted intents). Counted only while Kalshi doesn't list the client_order_id yet. */
  pendingIntents?: Array<{ cid: string; worst: number }>;
  localOrdersPerTicker?: Record<string, number>;
  /** Kalshi balance + portfolio value in USD (only needed for % limits) */
  accountValueUsd?: number;
}): AccountSnapshot {
  const start = etDayStart(input.now);
  const settledToday: Settled[] = [];
  let realized = 0;
  for (const s of input.settlements) {
    if (!desk(s.ticker)) continue;
    const ms = Date.parse(s.settled_time);
    if (!(ms >= start)) continue;
    const pnl = finiteAmount(s.revenue, "settlement revenue") / 100 -
      finiteAmount(s.yes_total_cost_dollars, "yes total cost", true) -
      finiteAmount(s.no_total_cost_dollars, "no total cost", true) -
      finiteAmount(s.fee_cost, "settlement fee", true);
    realized += pnl;
    settledToday.push({ ticker: s.ticker, pnl, settledMs: ms });
  }
  // Open worst case per ticker = max(Kalshi position exposure + fees, filled cost + fees of desk orders on it).
  // The order record shows a fill before /positions does, so the max covers the lag without double counting.
  const settledTickers = new Set(input.settlements.map((x) => x.ticker));
  const openBy = new Map<string, number>();
  const openDir = new Map<string, "up" | "down">();
  for (const p of input.positions) {
    // a settled contract is already in realized P/L; Kalshi can still list it under /positions for a while (double count)
    if (!desk(p.ticker) || settledTickers.has(p.ticker)) continue;
    const held = Number(p.position_fp);
    if (!Number.isFinite(held)) throw new Error("unknown open position size");
    if (Math.abs(held) < 1e-9) continue;
    openDir.set(p.ticker, held > 0 ? "up" : "down");
    openBy.set(p.ticker, finiteAmount(p.market_exposure_dollars, "position market exposure") +
      finiteAmount(p.fees_paid_dollars, "paid position fees", true));
  }
  const fillBy = new Map<string, number>();
  for (const o of input.ordersToday) {
    if (!desk(o.ticker) || settledTickers.has(o.ticker) || !(o.client_order_id ?? "").startsWith("mm1-")) continue;
    const filled = finiteAmount(o.fill_count_fp, "filled count", true);
    if (!(filled > 0)) continue;
    const cost = filled * sidePrice(o) + finiteAmount(o.taker_fees_dollars, "taker fees", true) +
      finiteAmount(o.maker_fees_dollars, "maker fees", true);
    fillBy.set(o.ticker, (fillBy.get(o.ticker) ?? 0) + cost);
    if (!openDir.has(o.ticker)) openDir.set(o.ticker, orderOutcomeSide(o) === "no" ? "down" : "up");
  }
  // correlated exposure: every coin's contract for the same 15-minute window, same direction, is one group
  const correlated: Record<string, number> = {};
  const tickerWorst: Record<string, number> = {};
  const addCorr = (ticker: string, dir: "up" | "down", worst: number) => {
    const k = correlationKey(ticker, dir);
    correlated[k] = Number(((correlated[k] ?? 0) + worst).toFixed(4));
    tickerWorst[ticker] = Number(((tickerWorst[ticker] ?? 0) + worst).toFixed(4));
  };
  let openWorst = 0;
  for (const t of new Set([...openBy.keys(), ...fillBy.keys()])) {
    const w = Math.max(openBy.get(t) ?? 0, fillBy.get(t) ?? 0);
    openWorst += w;
    addCorr(t, openDir.get(t) ?? "up", w);
  }
  // a pending send is "known" once Kalshi lists it anywhere (today's orders OR the resting list); then Kalshi's numbers count
  const known = new Set([...input.ordersToday, ...input.resting].map((o) => o.client_order_id).filter(Boolean));
  let pendingWorst = 0;
  for (const i of input.pendingIntents ?? []) {
    if (!Number.isFinite(i.worst) || i.worst < 0) throw new Error("invalid pending order risk");
    if (known.has(i.cid)) continue;
    pendingWorst += i.worst;
    const t = tickerOfCid(i.cid);
    // an ambiguous send whose ticker can't be read still counts in the totals; per-ticker/group it is charged to a sentinel
    addCorr(t ?? "unknown", /-n-\d+$/.test(i.cid) ? "down" : "up", i.worst);
  }
  let restWorst = 0;
  for (const o of input.resting) {
    if (!desk(o.ticker)) continue;
    const left = finiteAmount(o.remaining_count_fp, "resting order remaining");
    const px = sidePrice(o);
    const w = left * px + quadraticFee(left, px);
    restWorst += w;
    addCorr(o.ticker, orderOutcomeSide(o) === "no" ? "down" : "up", w);
  }
  const ordersPerTicker: Record<string, number> = {};
  for (const o of input.ordersToday) {
    if (!desk(o.ticker) || !(o.client_order_id ?? "").startsWith("mm1-")) continue;
    ordersPerTicker[o.ticker] = (ordersPerTicker[o.ticker] ?? 0) + 1;
  }
  for (const [t, n] of Object.entries(input.localOrdersPerTicker ?? {})) ordersPerTicker[t] = Math.max(ordersPerTicker[t] ?? 0, n);
  if (![realized, openWorst, restWorst, pendingWorst, input.shard2Cash].every(Number.isFinite) ||
      input.shard2Cash < 0) throw new Error("invalid account risk totals");
  return {
    fetchedAt: input.now,
    etDay: etDay(input.now),
    realizedToday: Number(realized.toFixed(4)),
    openWorst: Number(openWorst.toFixed(4)),
    restWorst: Number(restWorst.toFixed(4)),
    pendingWorst: Number(pendingWorst.toFixed(4)),
    shard2Cash: input.shard2Cash,
    settledToday,
    ordersPerTicker,
    correlated,
    tickerWorst,
    accountValueUsd: input.accountValueUsd,
    exchangeTradingActive: input.exchangeTradingActive,
    exchangeCheckedAt: input.exchangeCheckedAt,
  };
}

/** Live: the account's truth from Kalshi (settlements, positions, resting orders, today's orders, shard-2 cash). */
export type Position = { ticker: string; position_fp?: string; market_exposure_dollars?: string; fees_paid_dollars?: string };

export async function fetchSnapshot(ex: { tradingActive: boolean; at: number }, local: { pendingIntents: Array<{ cid: string; worst: number }>; perTicker: Record<string, number> }): Promise<{ snap: AccountSnapshot; resting: KOrder[]; positions: Position[] }> {
  const now = Date.now();
  const start = etDayStart(now);
  const minTs = Math.floor(start / 1000) - 3600;
  const [settlements, positions, resting, ordersToday, bal] = await Promise.all([
    pages<{ ticker: string; settled_time: string; revenue: number; yes_total_cost_dollars?: string; no_total_cost_dollars?: string; fee_cost?: string }>(`/trade-api/v2/portfolio/settlements?min_ts=${minTs}`, "settlements", 5),
    pages<Position>(`/trade-api/v2/portfolio/positions?count_filter=position`, "market_positions", 5),
    restingOrders(),
    ordersSince(minTs),
    kalshiGet<{ balance?: number; portfolio_value?: number; balance_breakdown?: Array<{ balance?: string; exchange_index?: number }> }>("/trade-api/v2/portfolio/balance"),
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
    pendingIntents: local.pendingIntents,
    localOrdersPerTicker: local.perTicker,
    accountValueUsd: Number.isFinite(bal.data.balance) && Number.isFinite(bal.data.portfolio_value) ? ((bal.data.balance as number) + (bal.data.portfolio_value as number)) / 100 : undefined,
  });
  return { snap, resting: resting.filter((o) => desk(o.ticker)), positions: positions.filter((p) => desk(p.ticker) && Math.abs(Number(p.position_fp ?? 0)) > 1e-9) };
}
