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

export function replayBooks(events: PersistedBookEvent[], opts?: { tradingActive?: boolean }): { books: Record<string, RebuiltBook>; gaps: number; reconnects: number; duplicates: number; skipped: number } {
  const live = new Map<string, LocalBook>();
  const sidSeq = new Map<number, number>();
  let gaps = 0, reconnects = 0, duplicates = 0, skipped = 0;
  const touch = (t: string) => {
    let b = live.get(t);
    if (!b) { b = new LocalBook(); live.set(t, b); }
    return b;
  };
  const seqState = (sid: number | null, seq: number | null): "ok" | "duplicate" | "gap" | "unsequenced" => {
    if (sid == null || seq == null) return "unsequenced";
    const prev = sidSeq.get(sid);
    if (prev == null) { sidSeq.set(sid, seq); return "ok"; }
    if (seq === prev) return "duplicate";
    sidSeq.set(sid, seq);
    return seq === prev + 1 ? "ok" : "gap";
  };
  for (const e of events) {
    if (e.kind === "seq_gap" || e.kind === "reconnect") {
      if (e.kind === "seq_gap") gaps++; else reconnects++;
      for (const b of live.values()) b.stale = true;
      if (e.sid != null) sidSeq.delete(e.sid);
      continue;
    }
    const ticker = e.market_ticker;
    if (!ticker) continue;
    const seq = seqState(e.sid, e.seq);
    if (seq === "duplicate") { duplicates++; skipped++; continue; }
    const b = touch(ticker);
    if (seq === "gap") {
      gaps++;
      for (const book of live.values()) book.stale = true;
      if (e.kind !== "orderbook_snapshot") { skipped++; continue; }
    }
    if (seq === "unsequenced" && e.kind !== "orderbook_snapshot") { skipped++; continue; }
    if (e.kind === "orderbook_snapshot") {
      b.snapshot({ bid: e.bid, ask: e.ask }, e.seq ?? 0, e.venueTs ?? e.rx);
      b.stale = false;
    } else if (!b.stale && e.price != null && e.delta != null && (e.side === "bid" || e.side === "ask")) {
      b.delta({ price: e.price, delta: e.delta, side: e.side, ts_ms: e.venueTs ?? undefined });
    } else skipped++;
  }
  const open = opts?.tradingActive !== false;
  const books: Record<string, RebuiltBook> = {};
  for (const [ticker, b] of live) {
    const top = b.top(50);
    const crossed = top.bestBid != null && top.bestAsk != null && top.bestBid >= top.bestAsk;
    const incomplete = top.bestBid == null || top.bestAsk == null;
    const bidDepth = top.bids.reduce((s, x) => s + x[1], 0);
    const askDepth = top.asks.reduce((s, x) => s + x[1], 0);
    books[ticker] = {
      ticker, bestBid: top.bestBid, bestAsk: top.bestAsk, bidDepth, askDepth, bids: top.bids, asks: top.asks,
      stale: b.stale, crossed, executable: open && !b.stale && !crossed && !incomplete, lastSeq: b.lastSeq,
    };
  }
  return { books, gaps, reconnects, duplicates, skipped };
}
