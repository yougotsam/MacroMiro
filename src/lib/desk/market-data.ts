/**
 * Read-only research market data (AURIX-X P1): real exchange OHLCV + signed-trade flow for the
 * sniper evidence engine. Public, unauthenticated Coinbase Exchange endpoints only; no keys, no
 * order routes. These are spot-exchange bars, NOT the CF Benchmarks settlement index, so they may
 * only feed research evidence, never the settlement probability or an order.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dataDir, type Series } from "./config";
import type { Candle } from "./sniper";

export const PUBLIC_HOST = "https://api.exchange.coinbase.com";
/** Gold (KXGOLD15M) has no public spot-exchange volume source here: unsupported, never proxied. */
export const RESEARCH_PRODUCT: Record<Series, string | null> = {
  KXBTC15M: "BTC-USD",
  KXETH15M: "ETH-USD",
  KXSOL15M: "SOL-USD",
  KXXRP15M: "XRP-USD",
  KXGOLD15M: null,
};
export const EMA_WARMUP_BARS = 200;
export type Interval = 1 | 5 | 15 | 60;

export type BarCheck = { bars: Candle[]; dropped: number; forming: number; gaps: Array<{ from: number; to: number }>; ok: boolean; problems: string[] };

/** Coinbase rows are [time_s, low, high, open, close, volume], newest first. */
export function parseCoinbaseCandles(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) throw new Error("candles: not an array");
  return rows.map((r) => {
    if (!Array.isArray(r) || r.length < 6) throw new Error("candles: bad row");
    const [t, l, h, o, c, v] = r.map(Number);
    return { t: t * 1000, o, h, l, c, v };
  });
}

/**
 * Keeps only complete, internally consistent bars on the interval grid, ascending and unique.
 * The still-forming bar (t + interval > now) is removed so nothing repaints. Gaps are reported, not filled.
 */
export function validateBars(input: Candle[], minutes: Interval, now: number): BarCheck {
  const ms = minutes * 60_000;
  const problems: string[] = [];
  let dropped = 0;
  let forming = 0;
  const byT = new Map<number, Candle>();
  for (const b of input) {
    const nums = [b.t, b.o, b.h, b.l, b.c, b.v ?? Number.NaN];
    const sane =
      nums.every(Number.isFinite) && b.t % ms === 0 && b.l > 0 && b.l <= Math.min(b.o, b.c) && b.h >= Math.max(b.o, b.c) && (b.v ?? -1) >= 0;
    if (!sane) {
      dropped += 1;
      continue;
    }
    if (b.t + ms > now) {
      forming += 1;
      continue;
    }
    const prev = byT.get(b.t);
    if (prev && JSON.stringify(prev) !== JSON.stringify(b)) problems.push(`conflicting bar at ${new Date(b.t).toISOString()}`);
    byT.set(b.t, b);
  }
  const bars = [...byT.values()].sort((a, b) => a.t - b.t);
  const gaps: BarCheck["gaps"] = [];
  for (let i = 1; i < bars.length; i += 1) if (bars[i].t - bars[i - 1].t !== ms) gaps.push({ from: bars[i - 1].t, to: bars[i].t });
  if (dropped) problems.push(`${dropped} malformed bar(s) dropped`);
  if (gaps.length) problems.push(`${gaps.length} gap(s); not filled`);
  return { bars, dropped, forming, gaps, ok: problems.length === 0 && bars.length > 0, problems };
}

/** The newest contiguous run of complete bars (after the last gap). */
export function contiguousTail(bars: Candle[], minutes: Interval): Candle[] {
  const ms = minutes * 60_000;
  let i = bars.length - 1;
  while (i > 0 && bars[i].t - bars[i - 1].t === ms) i -= 1;
  return bars.slice(Math.max(0, i));
}

/** EMA200 warm-up needs 200 contiguous complete bars ending at the latest complete bar, and that bar must be current. */
export function warmupReady(bars: Candle[], minutes: Interval, now: number, need = EMA_WARMUP_BARS): { ready: boolean; have: number; latestAgeMs: number | null } {
  const tail = contiguousTail(bars, minutes);
  const last = tail[tail.length - 1];
  const latestAgeMs = last ? now - (last.t + minutes * 60_000) : null;
  const current = latestAgeMs != null && latestAgeMs >= 0 && latestAgeMs < minutes * 60_000;
  return { ready: current && tail.length >= need, have: tail.length, latestAgeMs };
}

export type PublicTrade = { trade_id: number; side: string; size: string; price: string; time: string };

/**
 * Signed flow from public trades. Coinbase `side` is the MAKER side, so the aggressor is the
 * opposite: maker "sell" = aggressive buy (+size), maker "buy" = aggressive sell (−size).
 * Returns per-bar delta; bars with no trades in the covered span stay undefined (unknown, not 0).
 */
export function signedDeltaByBar(trades: PublicTrade[], minutes: Interval): Map<number, number> {
  const ms = minutes * 60_000;
  const out = new Map<number, number>();
  for (const tr of trades) {
    const t = Date.parse(tr.time);
    const size = Number(tr.size);
    if (!Number.isFinite(t) || !Number.isFinite(size) || size < 0) continue;
    const sign = tr.side === "sell" ? 1 : tr.side === "buy" ? -1 : 0;
    if (!sign) continue;
    const k = Math.floor(t / ms) * ms;
    out.set(k, (out.get(k) ?? 0) + sign * size);
  }
  return out;
}

/**
 * Attach signed delta only to bars fully covered by the trade sample: the bar holding the oldest
 * trade is partial and stays without delta (unknown), as do all earlier bars. Covered bars with no
 * trades get 0. Bars after the newest trade are left unknown too.
 */
export function attachDelta(bars: Candle[], trades: PublicTrade[], minutes: Interval): Candle[] {
  const times = trades.map((t) => Date.parse(t.time)).filter(Number.isFinite);
  if (!times.length) return bars;
  const ms = minutes * 60_000;
  const firstFull = Math.floor(Math.min(...times) / ms) * ms + ms;
  const lastSeen = Math.max(...times);
  const deltas = signedDeltaByBar(trades, minutes);
  return bars.map((b) => (b.t >= firstFull && b.t + ms <= lastSeen + 1 ? { ...b, delta: deltas.get(b.t) ?? 0 } : b));
}

type Fetch = (url: string) => Promise<unknown>;
const publicGet: Fetch = async (url) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { "user-agent": "macromiro-desk-research" } });
  if (!r.ok) throw new Error(`public GET ${r.status}`);
  return r.json();
};

/** Read-only GET of up to 300 bars. */
export async function fetchPublicCandles(product: string, minutes: Interval, get: Fetch = publicGet): Promise<Candle[]> {
  if (!/^[A-Z]{2,6}-USD$/.test(product)) throw new Error("product");
  return parseCoinbaseCandles(await get(`${PUBLIC_HOST}/products/${product}/candles?granularity=${minutes * 60}`));
}

/** Read-only GET of public trades, newest first, paging back with the `after` cursor until `sinceMs` or `maxPages`. */
export async function fetchPublicTrades(product: string, get: Fetch = publicGet, sinceMs = 0, maxPages = 1, pauseMs = 150): Promise<PublicTrade[]> {
  if (!/^[A-Z]{2,6}-USD$/.test(product)) throw new Error("product");
  const out: PublicTrade[] = [];
  let after: number | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await get(`${PUBLIC_HOST}/products/${product}/trades?limit=1000${after != null ? `&after=${after}` : ""}`);
    if (!Array.isArray(rows)) throw new Error("trades: not an array");
    const batch = rows as PublicTrade[];
    if (!batch.length) break;
    out.push(...batch);
    const oldest = batch[batch.length - 1];
    if (!Number.isInteger(oldest.trade_id) || (after != null && oldest.trade_id >= after)) break;
    after = oldest.trade_id;
    if (Date.parse(oldest.time) <= sinceMs) break;
    if (pauseMs) await new Promise((r) => setTimeout(r, pauseMs));
  }
  const seen = new Set<number>();
  return out.filter((t) => !seen.has(t.trade_id) && (seen.add(t.trade_id), true));
}

/** Persistent bar store: append-only JSONL per product/interval, merged and re-validated on read. */
export class BarStore {
  constructor(private dir = `${dataDir()}/bars`) {
    mkdirSync(this.dir, { recursive: true });
  }
  file(product: string, minutes: Interval) {
    return `${this.dir}/${product}-${minutes}m.jsonl`;
  }
  read(product: string, minutes: Interval, now = Date.now()): BarCheck {
    const f = this.file(product, minutes);
    const rows: Candle[] = [];
    if (existsSync(f)) {
      for (const l of readFileSync(f, "utf8").split("\n")) {
        if (!l.trim()) continue;
        try {
          rows.push(JSON.parse(l) as Candle);
        } catch {
          /* a torn last line is ignored; validateBars still checks the rest */
        }
      }
    }
    return validateBars(rows, minutes, now);
  }
  /** Appends only complete bars not already stored. Returns how many were added. */
  merge(product: string, minutes: Interval, fresh: Candle[], now = Date.now()): number {
    const have = new Set(this.read(product, minutes, now).bars.map((b) => b.t));
    const add = validateBars(fresh, minutes, now).bars.filter((b) => !have.has(b.t));
    if (add.length) appendFileSync(this.file(product, minutes), add.map((b) => JSON.stringify(b)).join("\n") + "\n");
    return add.length;
  }
}
