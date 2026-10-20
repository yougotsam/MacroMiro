/**
 * Tier B flow proxies. A proxy is measured. It is not the settlement index.
 * It feeds the logged flow vote only after both gates pass:
 *   rolling correlation of 15m returns with the settlement index stays ≥ PROXY_CORR_MIN
 *   and the scorecard says it improves Brier over Tier A alone.
 * No key, a weak correlation, or no Brier improvement: admitted stays false.
 * Nothing here changes a dollar cap or a send gate.
 */
import { SERIES, type Series } from "./config";
import { RESEARCH_PRODUCT } from "./market-data";
import { indexSnap } from "./index-bars";
import { brierImproves } from "../deskc/scorecard";
import { flowFromBars, type FlowVote } from "./features";
import type { Candle } from "./sniper";

/** Rolling correlation of 15-minute log returns. Prices look correlated even when they are not. */
export const PROXY_CORR_MIN = 0.85;
export const PROXY_MIN_RETURNS = 30;

export type ProxySnap = {
  series: Series;
  source: string;
  admitted: boolean;
  correlation: number | null;
  why: string;
  m15: Candle[] | null;
};

const cache = new Map<string, ProxySnap>();

export function proxyFor(series: string): ProxySnap | null {
  return cache.get(series) ?? null;
}
export function clearProxies(): void {
  cache.clear();
}

export function proxyFeedsStack(series: string): boolean {
  return proxyFor(series)?.admitted === true;
}

/** Logged flow from an admitted proxy only. Otherwise null, and the caller says the tape is unavailable. */
export function admittedFlow(series: string): FlowVote | null {
  const s = proxyFor(series);
  if (!s?.admitted || !s.m15?.length) return null;
  return flowFromBars(s.m15, s.source, true, null, null);
}

type Pair = { base: number; alt: number; y: 0 | 1 };

export function admitProxy(input: { key: boolean; correlation: number | null; rows: Pair[] }): { admitted: boolean; why: string; correlation: number | null } {
  if (!input.key) return { admitted: false, why: "no key", correlation: null };
  const c = input.correlation;
  if (c == null || !Number.isFinite(c)) return { admitted: false, why: "correlation unavailable", correlation: null };
  if (c < PROXY_CORR_MIN) return { admitted: false, why: `correlation ${c.toFixed(3)} < ${PROXY_CORR_MIN}`, correlation: c };
  const beat = brierImproves(input.rows);
  if (!beat.better) return { admitted: false, why: "no incremental brier", correlation: c };
  return { admitted: true, why: "admitted", correlation: c };
}

export function rollingCorrelation(indexBars: { t: number; c: number }[], proxyBars: { t: number; c: number }[]): number | null {
  const idx = new Map(indexBars.map((b) => [b.t, b.c]));
  const sorted = [...proxyBars].sort((a, b) => a.t - b.t);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (cur.t - prev.t !== 15 * 60_000) continue;
    const p0 = idx.get(prev.t);
    const p1 = idx.get(cur.t);
    if (p0 == null || p1 == null || p0 <= 0 || p1 <= 0 || prev.c <= 0 || cur.c <= 0) continue;
    xs.push(Math.log(p1 / p0));
    ys.push(Math.log(cur.c / prev.c));
  }
  if (xs.length < PROXY_MIN_RETURNS) return null;
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i += 1) {
    const a = xs[i] - mx;
    const b = ys[i] - my;
    num += a * b;
    dx += a * a;
    dy += b * b;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

type NinjaRow = { open?: unknown; high?: unknown; low?: unknown; close?: unknown; volume?: unknown; time?: unknown };

export function parseNinjaCandles(raw: unknown): Candle[] {
  if (!Array.isArray(raw)) return [];
  const out: Candle[] = [];
  for (const row of raw as NinjaRow[]) {
    const o = Number(row.open);
    const h = Number(row.high);
    const l = Number(row.low);
    const c = Number(row.close);
    const v = Number(row.volume);
    const sec = Number(row.time);
    if (![o, h, l, c, v, sec].every(Number.isFinite) || l <= 0 || v < 0) continue;
    const t = Math.floor(sec / 900) * 900 * 1000;
    out.push({ t, o, h, l, c, v });
  }
  const byT = new Map<number, Candle>();
  for (const b of out) byT.set(b.t, b);
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

type OandaCandle = { complete?: unknown; volume?: unknown; time?: unknown; mid?: { o?: unknown; h?: unknown; l?: unknown; c?: unknown } };

export function parseOandaCandles(raw: unknown): Candle[] {
  const rows = raw && typeof raw === "object" && Array.isArray((raw as { candles?: unknown }).candles)
    ? (raw as { candles: OandaCandle[] }).candles
    : [];
  const out: Candle[] = [];
  for (const row of rows) {
    if (row.complete === false) continue;
    const mid = row.mid;
    if (!mid) continue;
    const o = Number(mid.o);
    const h = Number(mid.h);
    const l = Number(mid.l);
    const c = Number(mid.c);
    const v = Number(row.volume);
    const ms = Date.parse(String(row.time));
    if (![o, h, l, c, v, ms].every(Number.isFinite) || l <= 0 || v < 0) continue;
    out.push({ t: Math.floor(ms / 900_000) * 900_000, o, h, l, c, v });
  }
  const byT = new Map<number, Candle>();
  for (const b of out) byT.set(b.t, b);
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

type Spec = { series: Series; source: string; venue: "ninjas" | "oanda"; path: string };

const NINJAS = "https://api.api-ninjas.com";
const OANDA = "https://api-fxpractice.oanda.com";

function specs(now: number): Spec[] {
  const start = Math.floor((now - 10 * 86_400_000) / 1000);
  const end = Math.floor(now / 1000);
  const q = `period=15m&start=${start}&end=${end}`;
  return [
    { series: "KXGOLD15M", source: "api-ninjas:GC", venue: "ninjas", path: `${NINJAS}/v1/goldpricehistorical?${q}` },
    { series: "KXSILVER15M", source: "api-ninjas:SI", venue: "ninjas", path: `${NINJAS}/v1/commoditypricehistorical?name=silver&${q}` },
    { series: "KXWTI15M", source: "api-ninjas:CL", venue: "ninjas", path: `${NINJAS}/v1/oilpricehistorical?type=wti&${q}` },
    { series: "KXGBPUSD15M", source: "oanda:GBP_USD", venue: "oanda", path: `${OANDA}/v3/instruments/GBP_USD/candles?granularity=M15&price=M&count=500` },
    { series: "KXEURUSD15M", source: "oanda:EUR_USD", venue: "oanda", path: `${OANDA}/v3/instruments/EUR_USD/candles?granularity=M15&price=M&count=500` },
    { series: "KXUSDJPY15M", source: "oanda:USD_JPY", venue: "oanda", path: `${OANDA}/v3/instruments/USD_JPY/candles?granularity=M15&price=M&count=500` },
  ];
}

function ninjaKey(env: Record<string, string | undefined>): string {
  return env.API_NINJAS_KEY || env.API_NINJAS || "";
}
function oandaToken(env: Record<string, string | undefined>): string {
  return env.OANDA_API_TOKEN || env.OANDA_TOKEN || "";
}

export async function warmProxies(deps: {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  now?: number;
  /** Settled Tier A vs proxy probabilities. Empty until a session has them. Empty does not admit. */
  rows?: (series: Series) => { base: number; alt: number; y: 0 | 1 }[];
} = {}): Promise<ProxySnap[]> {
  const env = deps.env ?? process.env;
  const now = deps.now ?? Date.now();
  const get = deps.fetch ?? fetch;
  const out: ProxySnap[] = [];
  for (const spec of specs(now)) {
    if (RESEARCH_PRODUCT[spec.series]) continue;
    const key = spec.venue === "ninjas" ? ninjaKey(env) : oandaToken(env);
    if (!key) {
      const snap: ProxySnap = { series: spec.series, source: spec.source, admitted: false, correlation: null, why: "no key", m15: null };
      cache.set(spec.series, snap);
      out.push(snap);
      continue;
    }
    let bars: Candle[] = [];
    let whyFetch: string | null = null;
    try {
      const headers: Record<string, string> = spec.venue === "ninjas" ? { "X-Api-Key": key } : { Authorization: `Bearer ${key}` };
      const res = await get(spec.path, { headers, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(String(res.status));
      const body: unknown = await res.json();
      bars = spec.venue === "ninjas" ? parseNinjaCandles(body) : parseOandaCandles(body);
    } catch {
      whyFetch = "fetch failed";
    }
    const index = indexSnap(spec.series)?.m15 ?? [];
    const correlation = whyFetch ? null : rollingCorrelation(index, bars);
    const rows = deps.rows?.(spec.series) ?? [];
    const decision = whyFetch
      ? { admitted: false, why: whyFetch, correlation: null as number | null }
      : admitProxy({ key: true, correlation, rows });
    const snap: ProxySnap = {
      series: spec.series,
      source: spec.source,
      admitted: decision.admitted,
      correlation: decision.correlation,
      why: decision.why,
      m15: decision.admitted ? bars : null,
    };
    cache.set(spec.series, snap);
    out.push(snap);
  }
  return out;
}

export function blindSeries(): Series[] {
  return SERIES.filter((s) => RESEARCH_PRODUCT[s] == null);
}
