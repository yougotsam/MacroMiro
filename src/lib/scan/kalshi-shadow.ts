import { appendLedger } from "@/lib/envelope/ledger.server";
import { shadowLanes, type ShadowFeatures } from "./shadow-lanes";
import { readSkill } from "./skill";
import { scoreBook } from "@/lib/skill/pipeline";
import { liveFeedBlocked } from "@/lib/skill/feeds";
import type { UpDownRound } from "./updown";

export type { ShadowFeatures, Lane } from "./shadow-lanes";
export { shadowLanes } from "./shadow-lanes";

const BASE = "https://api.elections.kalshi.com/trade-api/v2";
const UA = "Mozilla/5.0 (compatible; EnvelopeScan/1.0)";

type Candle = { t: number; o: number; c: number; h: number; l: number; v: number };
type BookSide = { best: number; size: number };

const lastLog = new Map<string, number>();

async function grab(path: string) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function rsi(closes: number[], period = 14) {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  const rs = loss === 0 ? 100 : gain / loss;
  return Number((100 - 100 / (1 + rs)).toFixed(1));
}

function bbWidth(closes: number[]) {
  const n = closes.slice(-20);
  if (n.length < 8) return null;
  const mean = n.reduce((a, b) => a + b, 0) / n.length;
  const sd = Math.sqrt(n.reduce((a, b) => a + (b - mean) ** 2, 0) / n.length);
  return mean ? Number(((2 * sd) / mean).toFixed(4)) : null;
}

function fibZone(bars: Candle[]): ShadowFeatures["fibZone"] {
  const closes = bars.map((b) => b.c).filter((c) => c > 0);
  if (closes.length < 5) return "none";
  const hi = Math.max(...closes);
  const lo = Math.min(...closes);
  const span = hi - lo;
  const last = closes.at(-1) ?? 0;
  if (span <= 0 || last <= 0) return "none";
  const inOte = (x: number) => x >= 0.62 && x <= 0.79;
  const inBand = inOte((hi - last) / span) || inOte((last - lo) / span);
  if (!inBand || !inOrderBlock(bars, last)) return "none";
  return "618";
}

/** Last opposite candle before a push, and price is back inside that candle. */
function inOrderBlock(bars: Candle[], last: number): boolean {
  const recent = bars.slice(-12);
  for (let i = recent.length - 2; i >= 1; i--) {
    const candle = recent[i];
    const next = recent[i + 1];
    if (!candle || !next) continue;
    const down = candle.c < candle.o;
    const up = candle.c > candle.o;
    const pushed = Math.abs(next.c - next.o) > Math.abs(candle.c - candle.o);
    const bull = down && pushed && next.c > candle.h;
    const bear = up && pushed && next.c < candle.l;
    if ((bull || bear) && last >= candle.l && last <= candle.h) return true;
  }
  return false;
}

function engulf(bars: Candle[]): "up" | "down" | null {
  const a = bars.at(-2);
  const b = bars.at(-1);
  if (!a || !b) return null;
  const up = b.c > a.c && b.h >= a.h && b.l <= a.l;
  const down = b.c < a.c && b.h >= a.h && b.l <= a.l;
  return up ? "up" : down ? "down" : null;
}

function feeEst(yes: number) {
  const p = Math.min(0.99, Math.max(0.01, yes));
  return Math.ceil(0.07 * p * (1 - p) * 100) / 100;
}

function bestBid(rows: unknown): BookSide {
  if (!Array.isArray(rows) || !rows.length) return { best: 0, size: 0 };
  const last = rows[rows.length - 1];
  if (!Array.isArray(last)) return { best: 0, size: 0 };
  return { best: Number(last[0]) || 0, size: Number(last[1]) || 0 };
}

const priorCache = new Map<string, { at: number; bars: Candle[] }>();

function candlesFrom(raw: Array<Record<string, unknown>>): Candle[] {
  return raw
    .map((c) => {
      const price = c.price as { open_dollars?: string; close_dollars?: string; high_dollars?: string; low_dollars?: string } | undefined;
      return {
        t: Number(c.end_period_ts ?? 0),
        o: Number(price?.open_dollars ?? price?.close_dollars ?? 0),
        c: Number(price?.close_dollars ?? 0),
        h: Number(price?.high_dollars ?? 0),
        l: Number(price?.low_dollars ?? 0),
        v: Number(c.volume_fp ?? 0),
      };
    })
    .filter((b) => b.c > 0);
}

async function priorCandles(series: string): Promise<Candle[]> {
  const hit = priorCache.get(series);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.bars;
  const now = Math.floor(Date.now() / 1000);
  const list = await grab(`/markets?series_ticker=${series}&status=settled&limit=8`);
  const tickers = ((list?.markets as { ticker?: string }[] | undefined) ?? []).map((m) => m.ticker).filter((t): t is string => !!t);
  const chunks = await Promise.all(
    tickers.map((ticker) => grab(`/series/${series}/markets/${ticker}/candlesticks?start_ts=${now - 6 * 3600}&end_ts=${now}&period_interval=1`)),
  );
  const bars = chunks.flatMap((sticks) => candlesFrom((sticks?.candlesticks as Array<Record<string, unknown>> | undefined) ?? []));
  bars.sort((a, b) => a.t - b.t);
  if (bars.length >= 14) priorCache.set(series, { at: Date.now(), bars });
  return bars;
}

export async function loadMicro(series: string, ticker: string) {
  const now = Math.floor(Date.now() / 1000);
  const [sticks, book, prior] = await Promise.all([
    grab(`/series/${series}/markets/${ticker}/candlesticks?start_ts=${now - 3600}&end_ts=${now}&period_interval=1`),
    grab(`/markets/${ticker}/orderbook`),
    priorCandles(series),
  ]);
  const current = candlesFrom((sticks?.candlesticks as Array<Record<string, unknown>> | undefined) ?? []);
  const byTime = new Map<number, Candle>();
  for (const bar of [...prior, ...current]) byTime.set(bar.t, bar);
  const bars = [...byTime.values()].sort((a, b) => a.t - b.t).slice(-120);
  const fp = (book?.orderbook_fp as { yes_dollars?: unknown; no_dollars?: unknown } | undefined) ?? {};
  const yes = bestBid(fp.yes_dollars);
  const no = bestBid(fp.no_dollars);
  const ask = no.best ? Number((1 - no.best).toFixed(4)) : 0;
  const spread = yes.best && ask ? Number((ask - yes.best).toFixed(4)) : null;
  const tot = yes.size + no.size;
  const bookImb = tot ? Number(((yes.size - no.size) / tot).toFixed(3)) : null;
  return { bars, spread, bookImb, yesBid: yes.best, yesBids: (fp.yes_dollars as [string, string][]) ?? [], noBids: (fp.no_dollars as [string, string][]) ?? [] };
}

export function featuresOf(round: UpDownRound, micro: Awaited<ReturnType<typeof loadMicro>>, newsBlocked: boolean): ShadowFeatures {
  const closes = micro.bars.map((b) => b.c);
  return {
    ticker: round.ticker ?? "",
    rsi: rsi(closes),
    bbWidth: bbWidth(closes),
    fibZone: fibZone(micro.bars),
    volume: micro.bars.reduce((a, b) => a + b.v, 0),
    engulf: engulf(micro.bars),
    spread: micro.spread,
    bookImb: micro.bookImb,
    payoutX: round.up > 0 ? Number((1 / round.up).toFixed(2)) : null,
    feeEst: feeEst(round.up),
    newsBlocked,
  };
}

export async function logShadow(rounds: UpDownRound[]) {
  const now = Date.now();
  for (const round of rounds) {
    if (round.book !== "btc" && round.book !== "gold") continue;
    if (!round.ticker || !round.series) continue;
    const prev = lastLog.get(round.ticker) ?? 0;
    if (now - prev < 45_000) continue;
    lastLog.set(round.ticker, now);
    try {
      const micro = await loadMicro(round.series, round.ticker);
      const newsBlocked = round.reason.includes("news");
      const feat = featuresOf(round, micro, newsBlocked);
      const skill = readSkill({
        bars: micro.bars,
        rsi: feat.rsi,
        bookImb: feat.bookImb,
        newsBlocked,
        engulf: feat.engulf,
      });
      const feed = liveFeedBlocked(round.book === "gold" ? "pyth-gold-1m" : "cf-brti-60s", false);
      const report = scoreBook({
        book: round.book === "gold" ? "gold" : "btc",
        bars: micro.bars.filter((b) => b.t > 0).map((b) => ({ ...b, closed: true })),
        nowSec: Math.floor(Date.now() / 1000),
        yesBids: micro.yesBids,
        noBids: micro.noBids,
        feed,
        beat: round.beat || null,
        volBps: null,
        leftSec: round.leftSec,
        newsBlocked,
        newsKnown: !round.reason.includes("news feed"),
      });
      const lanes = shadowLanes(round, feat);
      appendLedger({
        kind: "scan",
        mode: "scan",
        market_ticker: round.ticker,
        series_ticker: round.series,
        market_open_time: new Date(round.start * 1000).toISOString(),
        market_close_time: new Date(round.end * 1000).toISOString(),
        settlement_reference: "kalshi-floor-strike",
        time_to_expiry: round.leftSec,
        side: round.winner,
        market_probability: round.winner === "down" ? round.down : round.up,
        model_probability: null,
        edge_before_costs: null,
        edge_after_costs: null,
        fees: feat.feeEst,
        spread: feat.spread,
        features: JSON.stringify({ feat, skill, report, lanes, note: "shadow only · liveAllowed false" }),
        note: `shadow ${report.strategy} · ${report.reason}`,
      });
    } catch {
      /* shadow must never block the scan */
    }
  }
}
