/**
 * Coinbase candles for the sniper. Settlement probability still uses the index.
 * Missing bars stay missing. Nothing is invented across a gap.
 */
import { SERIES, type Series } from "./config";
import {
  RESEARCH_PRODUCT,
  BarStore,
  attachDelta,
  fetchPublicBook,
  fetchPublicCandles,
  fetchPublicTrades,
  type BookTop,
  type PublicTrade,
} from "./market-data";
import type { Candle } from "./sniper";

export const MIN_15 = 60;
export const MIN_1H = 205;
const FRESH_MS = 20 * 60_000;
/** CVD reads the last 8 closed 15m bars, and the oldest of those must be fully covered. One page of trades is about five minutes of bitcoin. */
const TAPE_MS = 9 * 15 * 60_000;
const TAPE_PAGES = 120;

export type ResearchSnap = {
  m15: Candle[];
  h1: Candle[];
  source: string | null;
  at: number;
  fresh: boolean;
  why: string | null;
  ofi: number | null;
  book: BookTop | null;
};

const cache = new Map<string, ResearchSnap>();
let armed = false;
let warming = false;

export function researchArmed(): boolean {
  return armed;
}
export function armResearch(on: boolean): void {
  armed = on;
}
export function clearResearch(): void {
  cache.clear();
  armed = false;
}
export function putResearch(series: string, snap: ResearchSnap): void {
  cache.set(series, snap);
}
export function researchFor(series: string): ResearchSnap | null {
  return cache.get(series) ?? null;
}

/** How many steps are absent. The caller does not fill them. */
export function missingSteps(times: number[], stepMs: number): number {
  if (times.length < 2 || stepMs <= 0) return 0;
  const s = [...times].sort((a, b) => a - b);
  let miss = 0;
  for (let i = 1; i < s.length; i += 1) {
    const gap = s[i] - s[i - 1];
    if (gap > stepMs) miss += Math.round(gap / stepMs) - 1;
  }
  return miss;
}

export function barsForSniper(series: string, index15: Candle[], index1h: Candle[]): { m15: Candle[]; h1: Candle[]; source: string } {
  const s = researchFor(series);
  const use15 = s && s.m15.length >= MIN_15 ? s.m15 : index15;
  const use1h = s && s.h1.length >= MIN_1H ? s.h1 : index1h;
  const source = s && s.m15.length >= MIN_15 ? s.source ?? "coinbase" : "index";
  return { m15: use15, h1: use1h, source };
}

/** A mapped product with no fresh tape sits. An unmapped market (gold, FX) is not blocked here. */
export function flowRefusal(series: Series): string | null {
  if (!armed) return null;
  if (!RESEARCH_PRODUCT[series]) return null;
  const s = researchFor(series);
  if (!s?.fresh) return "G1_flow_stale";
  return null;
}

function ofiOf(trades: PublicTrade[]): number | null {
  let sum = 0;
  let n = 0;
  for (const tr of trades) {
    const size = Number(tr.size);
    const sign = tr.side === "sell" ? 1 : tr.side === "buy" ? -1 : 0;
    if (!sign || !Number.isFinite(size) || size < 0) continue;
    sum += sign * size;
    n += 1;
  }
  return n ? sum : null;
}

function freshEnough(m15: Candle[], h1: Candle[], now: number): boolean {
  const last = m15[m15.length - 1];
  if (!last || m15.length < MIN_15 || h1.length < MIN_1H) return false;
  return now - (last.t + 15 * 60_000) < FRESH_MS;
}

export async function warmResearch(
  now = Date.now(),
  deps: {
    candles?: typeof fetchPublicCandles;
    trades?: typeof fetchPublicTrades;
    book?: typeof fetchPublicBook;
    store?: BarStore;
  } = {},
): Promise<void> {
  if (warming) return;
  warming = true;
  const candles = deps.candles ?? fetchPublicCandles;
  const trades = deps.trades ?? fetchPublicTrades;
  const book = deps.book ?? fetchPublicBook;
  const store = deps.store ?? new BarStore();
  const tapeSince = now - TAPE_MS;
  try {
    for (const series of SERIES) {
      const product = RESEARCH_PRODUCT[series];
      if (!product) {
        putResearch(series, { m15: [], h1: [], source: null, at: now, fresh: false, why: "no coinbase product", ofi: null, book: null });
        continue;
      }
      try {
        const [c15, c60, tape, top] = await Promise.all([
          candles(product, 15),
          candles(product, 60),
          trades(product, undefined, tapeSince, TAPE_PAGES, 40).catch(() => [] as PublicTrade[]),
          book(product).catch(() => null),
        ]);
        const signed = attachDelta(c15, tape, 15);
        store.merge(product, 15, signed, now);
        store.merge(product, 60, c60, now);
        const m15 = store.read(product, 15, now).bars;
        const h1 = store.read(product, 60, now).bars;
        const fresh = freshEnough(m15, h1, now);
        const signedN = m15.slice(-8).filter((b) => typeof b.delta === "number" && Number.isFinite(b.delta)).length;
        const coverage = `signed ${signedN}/8`;
        putResearch(series, {
          m15,
          h1,
          source: `coinbase:${product}`,
          at: now,
          fresh,
          why: fresh ? (signedN >= 8 ? null : coverage) : `bars 15m=${m15.length} 1h=${h1.length} ${coverage}`,
          ofi: ofiOf(tape),
          book: top,
        });
      } catch {
        putResearch(series, { m15: [], h1: [], source: `coinbase:${product}`, at: now, fresh: false, why: "coinbase_fetch_failed", ofi: null, book: null });
      }
    }
  } finally {
    warming = false;
  }
}
