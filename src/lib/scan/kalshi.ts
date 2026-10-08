import { type UpDownRound } from "./updown";
import type { BookId } from "@/lib/live/types";
import { loadPerps, perpCacheAge } from "./kalshi-perps";
import { brtiStatus, ensureBrti, ethRtiStatus, solRtiStatus, xrpRtiStatus } from "@/lib/skill/brti-socket.server";
import { ensurePyth, pythStatus } from "@/lib/skill/pyth-socket.server";
import { readDeskStatus } from "@/lib/desk/view";

const BASE = "https://api.elections.kalshi.com/trade-api/v2";
const UA = "Mozilla/5.0 (compatible; EnvelopeScan/1.0)";
const WINDOW = 900;
const indexTrail = new Map<string, { t: number; px: number }[]>();

/** Keep the settlement index so the next pass can see where it was 30 seconds ago. */
export function noteIndex(book: string, px: number, now = Date.now()) {
  if (!(px > 0)) return;
  const row = indexTrail.get(book) ?? [];
  const last = row[row.length - 1];
  if (!last || now - last.t >= 1000) row.push({ t: now, px });
  const cut = now - 120_000;
  while (row.length && row[0].t < cut) row.shift();
  indexTrail.set(book, row);
}

/** Newest saved index at least 30 seconds old, and not older than 50 seconds. */
export function index30sAgo(book: string, now = Date.now()): number | null {
  const row = indexTrail.get(book) ?? [];
  const target = now - 30_000;
  let best: { t: number; px: number } | null = null;
  for (const p of row) {
    if (p.t <= target && (!best || p.t > best.t)) best = p;
  }
  if (!best || target - best.t > 20_000) return null;
  return best.px;
}

export const KALSHI_BOOKS: { series: string; book: BookId }[] = [
  { series: "KXBTC15M", book: "btc" },
  { series: "KXGOLD15M", book: "gold" },
  { series: "KXSOL15M", book: "sol" },
  { series: "KXETH15M", book: "eth" },
  { series: "KXXRP15M", book: "xrp" },
];

type KalshiMarket = {
  ticker?: string;
  event_ticker?: string;
  title?: string;
  status?: string;
  rules_primary?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  last_price_dollars?: string;
  floor_strike?: number;
  exchange_index?: number;
  open_time?: string;
  close_time?: string;
  result?: string | null;
  volume_fp?: string;
};

let caches: Record<string, { at: number; data: UpDownRound }> = {};

function num(v: unknown) {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function grab<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const PERP_SPOT: Partial<Record<BookId, string>> = {
  btc: "KXBTCPERP",
  eth: "KXETHPERP",
  sol: "KXSOLPERP",
  xrp: "KXXRPPERP",
  gold: "KXGOLDPERP",
  silver: "KXSILVERPERP",
};

/** Implied index from Kalshi's own perp. Backup tape only. It does not settle the 15-minute ticket. */
async function kalshiIndex(ticker: string): Promise<{ px: number; ageMs: number | null }> {
  const perps = await loadPerps(false, 2_000);
  const ageMs = perpCacheAge();
  const p = perps.find((x) => x.ticker === ticker);
  if (!p) return { px: 0, ageMs };
  const px = p.ask || p.bid;
  const size = p.contractSize;
  return { px: size ? px / size : 0, ageMs };
}

async function spotFor(book: BookId): Promise<{ px: number; ageMs: number | null }> {
  const ticker = PERP_SPOT[book];
  if (ticker) return kalshiIndex(ticker);
  return { px: 0, ageMs: null };
}

/** Kalshi taker fee: 7% of C * p * (1-p), cents rounded up. */
export function kalshiFee(yes: number, contracts: number) {
  const p = Math.min(0.99, Math.max(0.01, yes));
  return Math.ceil(0.07 * contracts * p * (1 - p) * 100) / 100;
}

/** Whole contracts the order can buy. The clip is not one contract. */
export function contractCount(sizeUsd: number, yes: number) {
  if (!(yes > 0)) return 0;
  return Math.max(0, Math.floor(sizeUsd / yes));
}

export function kalshiPnl(sizeUsd: number, yes: number, settle: number, contracts?: number) {
  if (!yes) return 0;
  const c = contracts != null && contracts > 0 ? contracts : contractCount(sizeUsd, yes);
  if (!c) return 0;
  const fee = kalshiFee(yes, c);
  return Number((c * (settle - yes) - fee).toFixed(2));
}

async function loadFifteen(series: string, book: BookId, force: boolean): Promise<UpDownRound> {
  const hit = caches[series];
  if (!force && hit && Date.now() - hit.at < 2_000) return hit.data;
  const pack = await grab<{ markets?: KalshiMarket[] }>(`/markets?series_ticker=${series}&status=open&limit=6`);
  const now = Date.now();
  const live =
    (pack?.markets ?? []).find((m) => {
      const o = Date.parse(m.open_time || "");
      const c = Date.parse(m.close_time || "");
      const st = (m.status || "").toLowerCase();
      const open = Number.isFinite(o) && Number.isFinite(c) && o <= now && now < c;
      const active = !st || st === "active" || st === "open";
      return open && active && m.ticker;
    }) ?? null;

  const perpQuote = await spotFor(book);
  const perp = perpQuote.px;
  const perpFresh = perp > 0 && perpQuote.ageMs != null && perpQuote.ageMs <= 2_000;
  let last = perp;
  let modelSpot: number | null = null;
  let spotSource: "cf-brti-60s" | "cf-eth-60s" | "cf-sol-60s" | "cf-xrp-60s" | "pyth-gold-1m" | "kalshi-perp" | "none" = "none";
  let volBps1m: number | null = null;
  let bias30: "up" | "down" | "flat" | null = null;
  let push: boolean | null = null;
  let spotFallback = false;
  let minutes: { o: number; h: number; l: number; c: number }[] = [];
  if (book === "btc" || book === "eth" || book === "sol" || book === "xrp") {
    ensureBrti();
    const rti = book === "btc" ? brtiStatus() : book === "eth" ? ethRtiStatus() : book === "sol" ? solRtiStatus() : xrpRtiStatus();
    const source = book === "btc" ? "cf-brti-60s" : book === "eth" ? "cf-eth-60s" : book === "sol" ? "cf-sol-60s" : "cf-xrp-60s";
    bias30 = rti.bias30;
    push = rti.push;
    volBps1m = rti.volBps;
    minutes = rti.minutes ?? [];
    if (rti.healthy && rti.trailing60 != null) {
      last = rti.trailing60;
      modelSpot = rti.trailing60;
      spotSource = source;
    } else if (perpFresh) {
      last = perp;
      modelSpot = perp;
      spotSource = "kalshi-perp";
      spotFallback = true;
    }
  } else if (book === "gold") {
    ensurePyth();
    const pyth = pythStatus();
    volBps1m = pyth.volBps;
    bias30 = pyth.bias30;
    push = pyth.push;
    minutes = pyth.minutes ?? [];
    if (pyth.spot != null) last = pyth.spot;
    if (pyth.healthy && pyth.candleClose != null) {
      modelSpot = pyth.candleClose;
      spotSource = "pyth-gold-1m";
    } else if (perpFresh) {
      last = perp;
      modelSpot = perp;
      spotSource = "kalshi-perp";
      spotFallback = true;
    }
  } else if (perpFresh) {
    modelSpot = perp;
    spotSource = "kalshi-perp";
  }
  const empty: UpDownRound = {
    slug: series,
    question: `${series} 15m`,
    url: `https://kalshi.com/markets/${series.toLowerCase()}`,
    start: Math.floor(now / 1000 / WINDOW) * WINDOW,
    end: Math.floor(now / 1000 / WINDOW) * WINDOW + WINDOW,
    leftSec: 0,
    beat: 0,
    spot: last || 0,
    moveBps: 0,
    up: 0.5,
    down: 0.5,
    winner: "tie",
    decided: false,
    take: false,
    leg: null,
    chip: null,
    reason: `no ${series} · sit`,
    confirms: 0,
    missing: "no market",
    venue: "kalshi",
    ticker: "",
    book,
    series,
  };
  if (!live?.ticker) {
    caches[series] = { at: Date.now(), data: empty };
    return empty;
  }

  const start = Math.floor(Date.parse(live.open_time || "") / 1000) || Math.floor(now / 1000);
  const end = Math.floor(Date.parse(live.close_time || "") / 1000) || start + WINDOW;
  const leftSec = Math.max(0, end - Math.floor(now / 1000));
  const beat = num(live.floor_strike);
  // No quote means no price: never substitute last trade or 0.5.
  const up = num(live.yes_ask_dollars);
  const yesBid = num(live.yes_bid_dollars);
  const down = num(live.no_ask_dollars);
  const moveBps = beat && last ? ((last - beat) / beat) * 10_000 : 0;
  const winner: UpDownRound["winner"] = Math.abs(moveBps) < 1 ? "tie" : last >= beat ? "up" : "down";
  const base: Omit<UpDownRound, "take" | "leg" | "chip" | "reason"> = {
    slug: live.ticker,
    question: live.title || `${series} up in next 15 mins?`,
    url: `https://kalshi.com/markets/${(live.event_ticker || series).toLowerCase()}`,
    start,
    end,
    leftSec,
    beat,
    spot: last,
    moveBps,
    up,
    down,
    yesBid,
    winner,
    decided: Math.abs(moveBps) >= 2.5,
    venue: "kalshi",
    ticker: live.ticker,
    result: live.result === "yes" || live.result === "no" ? live.result : null,
    book,
    series,
    exchangeIndex: Number.isInteger(Number(live.exchange_index)) ? Number(live.exchange_index) : undefined,
  };
  let picked: Pick<UpDownRound, "take" | "leg" | "chip" | "reason" | "confirms" | "missing" | "cross" | "catalyst" | "clipScale"> = {
    take: false,
    leg: null,
    chip: null,
    confirms: 0,
    missing: "no market",
    reason: "sit",
  };
  if (!(up > 0 && yesBid > 0)) {
    picked = { ...picked, missing: "no quote", reason: "no quote · sit" };
  } else {
    // Display only. Orders come from the desk engine process (scripts/desk-engine.ts); this scan never takes.
    const desk = readDeskStatus()?.series.find((r) => r.ticker === live.ticker);
    const why = desk
      ? `desk ${desk.gate}${desk.p != null ? ` · P ${(desk.p * 100).toFixed(1)}%` : ""}${desk.best ? ` · ${desk.best.side} ${desk.best.mode} ${Math.round(desk.best.price * 100)}¢ edge ${(desk.best.edge * 100).toFixed(1)}¢` : ""}`
      : "desk engine offline";
    picked = {
      take: false,
      leg: desk?.best ? (desk.best.side === "yes" ? "up" : "down") : null,
      chip: null,
      confirms: 0,
      missing: why,
      reason: why,
    };
  }
  const data: UpDownRound = { ...base, ...picked, volBps1m, bias30 };
  caches[series] = { at: Date.now(), data };
  return data;
}

export async function loadKalshiRound(force = false): Promise<UpDownRound> {
  return loadFifteen("KXBTC15M", "btc", force);
}

export async function loadGoldFifteen(force = false): Promise<UpDownRound> {
  return loadFifteen("KXGOLD15M", "gold", force);
}

export async function loadKalshiBooks(force = false): Promise<UpDownRound[]> {
  return Promise.all(KALSHI_BOOKS.map((b) => loadFifteen(b.series, b.book, force)));
}

export async function kalshiResult(ticker: string): Promise<"yes" | "no" | null> {
  if (!ticker) return null;
  const pack = await grab<{ market?: KalshiMarket }>(`/markets/${encodeURIComponent(ticker)}`);
  const m = pack?.market;
  if (m?.result === "yes" || m?.result === "no") return m.result;
  return null;
}
