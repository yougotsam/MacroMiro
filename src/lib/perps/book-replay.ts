/**
 * Rebuild a Kalshi margin book from persisted websocket events.
 * A sequence gap or reconnect marks every book stale until the next snapshot.
 * A stale or crossed book is not executable. Queue position stays UNKNOWN.
 */
import { LocalBook } from "./stream";

export type PersistedBookEvent = {
  kind: "orderbook_snapshot" | "orderbook_delta" | "seq_gap" | "reconnect";
  market_ticker?: string;
  sid: number | null;
  seq: number | null;
  venueTs: number | null;
  rx: number;
  bid?: string[][];
  ask?: string[][];
  price?: string;
  delta?: string;
  side?: "bid" | "ask";
};

export type RebuiltBook = {
  ticker: string;
  bestBid: number | null;
  bestAsk: number | null;
  bidDepth: number;
  askDepth: number;
  bids: [number, number][];
  asks: [number, number][];
  stale: boolean;
  crossed: boolean;
  executable: boolean;
  lastSeq: number | null;
};

export function replayBooks(events: PersistedBookEvent[]): { books: Record<string, RebuiltBook>; gaps: number; reconnects: number } {
  const live = new Map<string, LocalBook>();
  let gaps = 0, reconnects = 0;
  const touch = (t: string) => {
    let b = live.get(t);
    if (!b) { b = new LocalBook(); live.set(t, b); }
    return b;
  };
  for (const e of events) {
    if (e.kind === "seq_gap" || e.kind === "reconnect") {
      if (e.kind === "seq_gap") gaps++; else reconnects++;
      for (const b of live.values()) b.stale = true;
      continue;
    }
    const ticker = e.market_ticker;
    if (!ticker) continue;
    const b = touch(ticker);
    if (e.kind === "orderbook_snapshot") {
      b.snapshot({ bid: e.bid, ask: e.ask }, e.seq ?? 0, e.venueTs ?? e.rx);
      b.stale = false;
    } else if (!b.stale && e.price != null && e.delta != null && (e.side === "bid" || e.side === "ask")) {
      b.delta({ price: e.price, delta: e.delta, side: e.side, ts_ms: e.venueTs ?? undefined });
    }
  }
  const books: Record<string, RebuiltBook> = {};
  for (const [ticker, b] of live) {
    const top = b.top(50);
    const crossed = top.bestBid != null && top.bestAsk != null && top.bestBid >= top.bestAsk;
    const bidDepth = top.bids.reduce((s, x) => s + x[1], 0);
    const askDepth = top.asks.reduce((s, x) => s + x[1], 0);
    books[ticker] = {
      ticker, bestBid: top.bestBid, bestAsk: top.bestAsk, bidDepth, askDepth, bids: top.bids, asks: top.asks,
      stale: b.stale, crossed, executable: !b.stale && !crossed && top.bestBid != null && top.bestAsk != null, lastSeq: b.lastSeq,
    };
  }
  return { books, gaps, reconnects };
}
