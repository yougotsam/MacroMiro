import { type UpDownRound } from "./updown";
import type { BookId } from "@/lib/live/types";
import { loadPerps } from "./kalshi-perps";
import { macroNewsKill } from "./news-kill";
import { edgeDecision } from "./edge";
import { inEventBlackout } from "./blackout";
import { ema } from "@/lib/skill/ta";
import { loadMicro, featuresOf } from "./kalshi-shadow";
import { brtiStatus, ensureBrti, ethRtiStatus, solRtiStatus } from "@/lib/skill/brti-socket.server";
import { ensurePyth, pythStatus } from "@/lib/skill/pyth-socket.server";

const BASE = "https://api.elections.kalshi.com/trade-api/v2";
const UA = "Mozilla/5.0 (compatible; EnvelopeScan/1.0)";
const WINDOW = 900;
const LATE_SEC = 40;
const TOO_LATE = 60;
/** Sit the first minute. The last minute is the settlement average, so that sits too. */
const OPEN_SIT = 840;
const LATE_BPS = 2.5;
const MOM_BPS = 5;
const HARD_BPS = 8;
/** Paper late fills were 0.77–0.84. Skip only ≥0.86 (99¢ trophies). */
const MAX_YES = 0.85;
const MIN_YES_LATE = 0.75;
const MIN_YES_GAP = 0.4;
const MAX_YES_GAP = 0.85;

const KLINE_SYM: Partial<Record<BookId, string>> = {
  btc: "BTCUSDT",
  eth: "ETHUSDT",
  sol: "SOLUSDT",
  gold: "PAXGUSDT",
  silver: "PAXGUSDT",
};

type MiniBar = { o: number; h: number; l: number; c: number };
type Tape1 = {
  last: MiniBar | null;
  prior: MiniBar | null;
  engulf: "up" | "down" | null;
  ticks: "up" | "down" | null;
  body: "up" | "down" | null;
  ok: boolean;
};
const tapeCache: Record<string, { at: number; data: Tape1 }> = {};

async function loadTape1(book: BookId): Promise<Tape1> {
  const empty: Tape1 = { last: null, prior: null, engulf: null, ticks: null, body: null, ok: false };
  const sym = KLINE_SYM[book];
  if (!sym) return empty;
  const hit = tapeCache[sym];
  if (hit && Date.now() - hit.at < 15_000) return hit.data;
  try {
    const url = `https://api.binance.us/api/v3/klines?symbol=${sym}&interval=1m&limit=8`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return empty;
    const rows = (await res.json()) as unknown;
    if (!Array.isArray(rows)) return empty;
    const bars: MiniBar[] = [];
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const o = Number(row[1]);
      const h = Number(row[2]);
      const l = Number(row[3]);
      const c = Number(row[4]);
      if (![o, h, l, c].every((x) => Number.isFinite(x) && x > 0)) continue;
      bars.push({ o, h, l, c });
    }
    const last = bars.at(-1) ?? null;
    const prior = bars.at(-2) ?? null;
    let engulf: Tape1["engulf"] = null;
    if (last && prior) {
      const lastBull = last.c > last.o;
      const priorBear = prior.c < prior.o;
      const lastBear = last.c < last.o;
      const priorBull = prior.c > prior.o;
      const lastBody = Math.abs(last.c - last.o);
      const priorBody = Math.abs(prior.c - prior.o);
      if (lastBull && priorBear && last.o <= prior.c && last.c >= prior.o && lastBody >= priorBody) engulf = "up";
      if (lastBear && priorBull && last.o >= prior.c && last.c <= prior.o && lastBody >= priorBody) engulf = "down";
    }
    const closes = bars.slice(-4).map((b) => b.c);
    let ticks: Tape1["ticks"] = null;
    if (closes.length >= 3) {
      const a = closes[closes.length - 3];
      const b = closes[closes.length - 2];
      const d = closes[closes.length - 1];
      if (d > b && b > a) ticks = "up";
      if (d < b && b < a) ticks = "down";
    }
    const body: Tape1["body"] = last ? (last.c > last.o ? "up" : last.c < last.o ? "down" : null) : null;
    const data: Tape1 = { last, prior, engulf, ticks, body, ok: bars.length >= 2 };
    tapeCache[sym] = { at: Date.now(), data };
    return data;
  } catch {
    return empty;
  }
}

export const KALSHI_BOOKS: { series: string; book: BookId }[] = [
  { series: "KXBTC15M", book: "btc" },
  { series: "KXGOLD15M", book: "gold" },
  { series: "KXSOL15M", book: "sol" },
  { series: "KXETH15M", book: "eth" },
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
  gold: "KXGOLDPERP",
  silver: "KXSILVERPERP",
};

/** Implied index from Kalshi's own perp (bid / contract_size). Not licensed BRTI 60s TWAP. Same venue as the 15m. */
async function kalshiIndex(ticker: string): Promise<number> {
  const perps = await loadPerps();
  const p = perps.find((x) => x.ticker === ticker);
  if (!p) return 0;
  const px = p.ask || p.bid;
  const size = p.contractSize;
  return size ? px / size : 0;
}

async function spotFor(book: BookId): Promise<number> {
  const ticker = PERP_SPOT[book];
  if (ticker) return kalshiIndex(ticker);
  return 0;
}

function decide(
  r: Omit<UpDownRound, "take" | "leg" | "chip" | "reason" | "confirms" | "missing">,
  news: { kill: boolean; name: string | null },
  tape: Tape1,
): Pick<UpDownRound, "take" | "leg" | "chip" | "reason" | "confirms" | "missing"> {
  const { leftSec, moveBps, up, down, winner } = r;
  const withTape = winner !== "tie" && (tape.body === winner || tape.ticks === winner || tape.engulf === winner);
  const fight = winner !== "tie" && (tape.engulf === (winner === "up" ? "down" : "up") || (tape.ticks && tape.ticks !== winner));
  const late = leftSec <= LATE_SEC;
  const need = late ? LATE_BPS : tape.engulf === winner ? LATE_BPS : withTape ? MOM_BPS : HARD_BPS;
  const c1 = winner !== "tie" && !!r.beat && !!r.spot;
  const c2 = Math.abs(moveBps) >= need && !fight;
  const c3 = !news.kill;
  const n = [c1, c2, c3].filter(Boolean).length;
  const missing = !c1
    ? "no side vs strike"
    : fight
      ? "1m tape fights"
      : !c2
        ? `move ${moveBps.toFixed(1)}bp < ${need}`
        : !c3
          ? `news ${news.name}`
          : null;

  if (!r.beat || !r.spot) return { take: false, leg: null, chip: null, confirms: n, missing, reason: `0/3 · no beat/spot` };
  if (leftSec <= TOO_LATE) return { take: false, leg: null, chip: null, confirms: n, missing, reason: `${n}/3 · ${leftSec}s too late` };
  if (leftSec > OPEN_SIT) return { take: false, leg: null, chip: null, confirms: n, missing, reason: `${n}/3 · first 1m sit` };
  if (!c3) return { take: false, leg: null, chip: null, confirms: n, missing, reason: `${n}/3 · news sit · ${news.name}` };
  if (!c1) return { take: false, leg: null, chip: null, confirms: n, missing, reason: `${n}/3 · sitting on the line` };
  if (fight) {
    return { take: false, leg: null, chip: null, confirms: n, missing, reason: `${n}/3 · 1m ${tape.ticks ?? tape.engulf ?? tape.body} vs ${winner}` };
  }
  if (!c2) {
    return {
      take: false,
      leg: null,
      chip: null,
      confirms: n,
      missing,
      reason: `${n}/3 · ${leftSec}s · ${moveBps >= 0 ? "+" : ""}${moveBps.toFixed(1)}bp · need ${need}${tape.engulf ? " engulf" : tape.ticks ? " ticks" : ""}`,
    };
  }
  if (up >= MAX_YES && down >= MAX_YES) {
    return { take: false, leg: null, chip: null, confirms: n, missing: "book too rich", reason: `${n}/3 · too rich UP ${up.toFixed(3)}` };
  }
  const tag = tape.engulf === winner ? "engulf" : tape.ticks === winner ? "3x1m" : tape.body === winner ? "1m" : "dist";
  if (late) {
    const yes = winner === "up" ? up : down;
    if (yes > MAX_YES || yes < MIN_YES_LATE) {
      return { take: false, leg: null, chip: null, confirms: n, missing: "late price", reason: `${n}/3 · late ${yes.toFixed(3)} skip` };
    }
    return {
      take: true,
      leg: winner,
      chip: "late-window",
      confirms: 3,
      missing: null,
      reason: `3/3 late ${leftSec}s · ${winner.toUpperCase()} ${yes.toFixed(3)} · ${tag}`,
    };
  }
  if (moveBps >= need && up >= MIN_YES_GAP && up <= MAX_YES_GAP && winner === "up") {
    return { take: true, leg: "up", chip: "mom-gap", confirms: 3, missing: null, reason: `3/3 ${tag} +${moveBps.toFixed(1)}bp · BUY YES ${up.toFixed(3)}` };
  }
  if (moveBps <= -need && down >= MIN_YES_GAP && down <= MAX_YES_GAP && winner === "down") {
    return { take: true, leg: "down", chip: "mom-gap", confirms: 3, missing: null, reason: `3/3 ${tag} ${moveBps.toFixed(1)}bp · SELL YES ${down.toFixed(3)}` };
  }
  return {
    take: false,
    leg: null,
    chip: null,
    confirms: n,
    missing: "price band",
    reason: `${n}/3 · ${leftSec}s · ${moveBps >= 0 ? "+" : ""}${moveBps.toFixed(1)}bp · UP ${up.toFixed(3)}`,
  };
}

/** Kalshi taker fee: 7% of C * p * (1-p), cents rounded up. */
export function kalshiFee(yes: number, contracts: number) {
  const p = Math.min(0.99, Math.max(0.01, yes));
  return Math.ceil(0.07 * contracts * p * (1 - p) * 100) / 100;
}

export function kalshiPnl(sizeUsd: number, yes: number, settle: number) {
  if (!yes) return 0;
  const contracts = sizeUsd / yes;
  const fee = kalshiFee(yes, contracts);
  return Number((contracts * (settle - yes) - fee).toFixed(2));
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

  const perp = await spotFor(book);
  let last = perp;
  let modelSpot: number | null = null;
  let spotSource: "cf-brti-60s" | "cf-eth-60s" | "cf-sol-60s" | "pyth-gold-1m" | "kalshi-perp" | "none" = "none";
  let volBps1m: number | null = null;
  let bias30: "up" | "down" | "flat" | null = null;
  let push: boolean | null = null;
  if (book === "btc" || book === "eth" || book === "sol") {
    ensureBrti();
    const rti = book === "btc" ? brtiStatus() : book === "eth" ? ethRtiStatus() : solRtiStatus();
    const source = book === "btc" ? "cf-brti-60s" : book === "eth" ? "cf-eth-60s" : "cf-sol-60s";
    bias30 = rti.bias30;
    push = rti.push;
    if (rti.healthy && rti.trailing60 != null) {
      last = rti.trailing60;
      modelSpot = rti.trailing60;
      spotSource = source;
      volBps1m = rti.volBps;
    }
  } else if (book === "gold") {
    ensurePyth();
    const pyth = pythStatus();
    if (pyth.spot != null) last = pyth.spot;
    if (pyth.healthy && pyth.candleClose != null) {
      modelSpot = pyth.candleClose;
      spotSource = "pyth-gold-1m";
      volBps1m = pyth.volBps;
    }
    bias30 = pyth.bias30;
    push = pyth.push;
  } else if (perp) {
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
  const up = num(live.yes_ask_dollars || live.last_price_dollars) || 0.5;
  const yesBid = num(live.yes_bid_dollars);
  const down = num(live.no_ask_dollars) || Number((1 - num(live.yes_bid_dollars || up)).toFixed(4));
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
    decided: Math.abs(moveBps) >= LATE_BPS,
    venue: "kalshi",
    ticker: live.ticker,
    result: live.result === "yes" || live.result === "no" ? live.result : null,
    book,
    series,
  };
  const news = await macroNewsKill();
  const tape = await loadTape1(book);
  let picked = decide(base, news, tape);
  if (!tape.ok) {
    picked = { take: false, leg: null, chip: null, confirms: picked.confirms, missing: "stale tape", reason: `0/3 · no 1m tape` };
  }
  if (!last || !beat) {
    picked = { take: false, leg: null, chip: null, confirms: picked.confirms, missing: "no settlement ref", reason: `0/3 · no strike/spot` };
  }
  if (!news.ok) {
    picked = { take: false, leg: null, chip: null, confirms: picked.confirms, missing: "calendar fail", reason: `0/3 · news feed down` };
  }
  if (now >= end * 1000 || now < start * 1000) {
    picked = { take: false, leg: null, chip: null, confirms: picked.confirms, missing: "closed", reason: `0/3 · market closed` };
  }
  if ((book === "btc" || book === "gold" || book === "eth" || book === "sol") && live.ticker) {
    let rules = live.rules_primary || "";
    if (!rules) {
      const one = await grab<{ market?: KalshiMarket }>(`/markets/${encodeURIComponent(live.ticker)}`);
      rules = one?.market?.rules_primary || "";
    }
    let bookImb: number | null = null;
    let rsi: number | null = null;
    let bbWidth: number | null = null;
    let fibZone: "none" | "236" | "382" | "500" | "618" | null = null;
    let volume: number | null = null;
    let engulf: "up" | "down" | null = null;
    let ema7: number | null = null;
    let ema14: number | null = null;
    try {
      const micro = await loadMicro(live.event_ticker ? series : series, live.ticker);
      bookImb = micro.bookImb;
      const closes = micro.bars.map((b) => b.c);
      ema7 = ema(closes, 7);
      ema14 = ema(closes, 14);
      const feat = featuresOf(
        { ...base, take: false, leg: null, chip: null, reason: "" },
        micro,
        !news.ok,
      );
      rsi = feat.rsi;
      bbWidth = feat.bbWidth;
      fibZone = feat.fibZone;
      volume = feat.volume;
      engulf = feat.engulf;
    } catch {
      bookImb = null;
    }
    const edge = edgeDecision({
      book,
      status: live.status || "active",
      leftSec,
      openTs: start,
      closeTs: end,
      now: Math.floor(now / 1000),
      beat,
      spot: modelSpot,
      spotSource,
      rules,
      yesAsk: up,
      yesBid,
      noAsk: down,
      volBps1m,
      tapeOk: spotSource === "kalshi-perp" || spotSource === "none" ? tape.ok : true,
      newsOk: news.ok,
      bookImb,
      rsi,
      bbWidth,
      fibZone,
      volume,
      engulf,
      fresh: spotSource === "kalshi-perp" || spotSource === "none" ? tape.ok : true,
      ema7,
      ema14,
      bias30,
      push,
      blackout: inEventBlackout(now),
    });
    picked = {
      take: edge.take,
      leg: edge.leg,
      chip: edge.take ? "settle-ta" : null,
      confirms: picked.confirms,
      missing: edge.why,
      reason: `${edge.strategy} · ${edge.settlement} · ${edge.why}`,
      cross: edge.cross,
      catalyst: edge.catalyst,
    };
  }
  const data: UpDownRound = { ...base, ...picked };
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
