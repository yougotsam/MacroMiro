/**
 * Pure pieces of the perps collector: a local order book from WS `orderbook_snapshot` + `orderbook_delta`
 * (per-subscription `seq` gap → resync), and 1m/5m/15m candles built from public `trade` messages
 * (price string, count string, taker_side, ts_ms). Fields from docs.kalshi.com perps_asyncapi.yaml.
 */
export type Level = [number, number];
export class LocalBook {
  bids = new Map<number, number>(); asks = new Map<number, number>(); lastSeq: number | null = null; stale = true; updatedMs = 0;
  snapshot(msg: { bid?: string[][]; ask?: string[][] }, seq: number, ts = Date.now()) {
    this.bids.clear(); this.asks.clear();
    for (const [p, c] of msg.bid ?? []) this.bids.set(Number(p), Number(c));
    for (const [p, c] of msg.ask ?? []) this.asks.set(Number(p), Number(c));
    this.lastSeq = seq; this.stale = false; this.updatedMs = ts;
  }
  /** apply one delta; sequence checking is per subscription (see SeqTracker), not per market */
  delta(msg: { price: string; delta: string; side: "bid" | "ask"; ts_ms?: number }): boolean {
    if (this.stale) return false;
    const m = msg.side === "bid" ? this.bids : this.asks; const p = Number(msg.price);
    const v = (m.get(p) ?? 0) + Number(msg.delta);
    if (v <= 1e-9) m.delete(p); else m.set(p, v);
    this.updatedMs = msg.ts_ms ?? Date.now();
    return true;
  }
  top(n = 10) {
    const bids = [...this.bids.entries()].sort((a, b) => b[0] - a[0]).slice(0, n) as Level[];
    const asks = [...this.asks.entries()].sort((a, b) => a[0] - b[0]).slice(0, n) as Level[];
    return { bids, asks, bestBid: bids[0]?.[0] ?? null, bestAsk: asks[0]?.[0] ?? null };
  }
}

/** `seq` is per subscription id (sid) and covers snapshots and deltas of every market on that sid. */
export class SeqTracker {
  last = new Map<number, number>();
  /** true if in order; false on a gap (caller marks books stale and resubscribes with send_initial_snapshot) */
  ok(sid: number, seq: number) { const prev = this.last.get(sid); this.last.set(sid, seq); return prev == null ? seq === 1 : seq === prev + 1; }
}

export type TradeMsg = { trade_id: string; market_ticker: string; price: string; count: string; taker_side: "bid" | "ask"; ts_ms: number };
export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number; n: number; buyV: number; sellV: number };
/** Candle builder from trades. Buy volume = taker_side "bid" (aggressive buyer). Only closed bars are emitted. */
export class CandleBuilder {
  private cur = new Map<number, Bar>(); seen = new Set<string>();
  constructor(public periodMs: number) {}
  add(t: TradeMsg): Bar[] {
    if (this.seen.has(t.trade_id)) return []; this.seen.add(t.trade_id);
    if (this.seen.size > 50_000) this.seen = new Set([...this.seen].slice(-20_000));
    const start = Math.floor(t.ts_ms / this.periodMs) * this.periodMs; const p = Number(t.price), q = Number(t.count);
    if (!(p > 0) || !(q > 0)) return [];
    const closed: Bar[] = [];
    for (const [s, b] of this.cur) if (s < start) { closed.push(b); this.cur.delete(s); }
    const b = this.cur.get(start);
    if (!b) this.cur.set(start, { t: start, o: p, h: p, l: p, c: p, v: q, n: 1, buyV: t.taker_side === "bid" ? q : 0, sellV: t.taker_side === "ask" ? q : 0 });
    else { b.h = Math.max(b.h, p); b.l = Math.min(b.l, p); b.c = p; b.v += q; b.n += 1; if (t.taker_side === "bid") b.buyV += q; else b.sellV += q; }
    return closed.sort((a, b2) => a.t - b2.t);
  }
  /** close bars whose period has ended even without a new trade */
  flush(nowMs: number): Bar[] { const out: Bar[] = []; for (const [s, b] of this.cur) if (s + this.periodMs <= nowMs) { out.push(b); this.cur.delete(s); } return out; }
}

/** Dynamic registry: priority markets first, then any active market with enough depth/volume. */
export const PRIORITY = ["KXBTCPERP", "KXETHPERP", "KXGOLDPERP"];
export function eligibleMarkets(ms: { ticker: string; status: string; volume24hUsd: number | null; openInterestUsd: number | null }[], minVol = 250_000, minOi = 100_000) {
  const act = ms.filter((m) => m.status === "active");
  const pri = PRIORITY.filter((t) => act.some((m) => m.ticker === t));
  const rest = act.filter((m) => !pri.includes(m.ticker) && (m.volume24hUsd ?? 0) >= minVol && (m.openInterestUsd ?? 0) >= minOi).sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0)).map((m) => m.ticker);
  return [...pri, ...rest];
}
