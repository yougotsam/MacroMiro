/**
 * Rebuild a Kalshi margin book from persisted websocket events.
 * A sequence gap or reconnect marks every book stale until the next snapshot.
 * A stale or crossed book is not executable. Queue position stays UNKNOWN.
 */
import { LocalBook } from "./stream";

export type PersistedBookEvent = {
  kind: "orderbook_snapshot" | "orderbook_delta" | "seq_gap" | "reconnect" | "rollover_seed" | "day_cursor";
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
  /** Copied from memory at UTC midnight. Not a venue snapshot. */
  seeded?: boolean;
  /** The in-memory book was already stale when this row was written. */
  stale?: boolean;
  /** True when the row does not contain every level. */
  depthLimited?: boolean;
  /** Last per-market sequence remembered at midnight. Not the shared subscription sequence. */
  bookSeq?: number | null;
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
  depthLimited: boolean;
  executable: boolean;
  lastSeq: number | null;
};

export function replayBooks(events: PersistedBookEvent[], opts?: { tradingActive?: boolean }): { books: Record<string, RebuiltBook>; gaps: number; reconnects: number; duplicates: number; skipped: number } {
  const live = new Map<string, LocalBook>();
  const limited = new Map<string, boolean>();
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
    if (e.kind === "day_cursor") {
      if (e.sid != null && e.seq != null) sidSeq.set(e.sid, e.seq);
      continue;
    }
    if (e.kind === "seq_gap" || e.kind === "reconnect") {
      if (e.kind === "seq_gap") gaps++; else reconnects++;
      for (const b of live.values()) b.stale = true;
      if (e.sid != null) sidSeq.delete(e.sid);
      continue;
    }
    const ticker = e.market_ticker;
    if (!ticker) continue;
    const image = e.kind === "rollover_seed" || (e.kind === "orderbook_snapshot" && e.seeded === true);
    if (image) {
      const b = touch(ticker);
      b.snapshot({ bid: e.bid, ask: e.ask }, e.bookSeq ?? e.seq ?? 0, e.venueTs ?? e.rx);
      b.stale = e.stale === true;
      limited.set(ticker, e.depthLimited === true);
      continue;
    }
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
      b.stale = e.stale === true;
      limited.set(ticker, e.depthLimited === true);
    } else if (!b.stale && e.price != null && e.delta != null && (e.side === "bid" || e.side === "ask")) {
      b.delta({ price: e.price, delta: e.delta, side: e.side, ts_ms: e.venueTs ?? undefined });
      if (e.seq != null) b.lastSeq = e.seq;
    } else skipped++;
  }
  const open = opts?.tradingActive === true;
  const books: Record<string, RebuiltBook> = {};
  for (const [ticker, b] of live) {
    const top = b.top(50);
    const crossed = top.bestBid != null && top.bestAsk != null && top.bestBid >= top.bestAsk;
    const incomplete = top.bestBid == null || top.bestAsk == null;
    const depthLimited = limited.get(ticker) === true;
    const bidDepth = top.bids.reduce((s, x) => s + x[1], 0);
    const askDepth = top.asks.reduce((s, x) => s + x[1], 0);
    books[ticker] = {
      ticker, bestBid: top.bestBid, bestAsk: top.bestAsk, bidDepth, askDepth, bids: top.bids, asks: top.asks,
      stale: b.stale, crossed, depthLimited, executable: open && !b.stale && !depthLimited && !crossed && !incomplete, lastSeq: b.lastSeq,
    };
  }
  return { books, gaps, reconnects, duplicates, skipped };
}

/** Full in-memory book for a new UTC-day file. A stale book stays stale. Top-80 is not used. */
export function rolloverSeed(ticker: string, book: LocalBook, sid: number | null): PersistedBookEvent {
  const bids = [...book.bids.entries()].sort((a, b) => b[0] - a[0]);
  const asks = [...book.asks.entries()].sort((a, b) => a[0] - b[0]);
  const unanchored = book.lastSeq == null || sid == null;
  return {
    kind: "rollover_seed", market_ticker: ticker, sid: null, seq: null, bookSeq: book.lastSeq, venueTs: book.updatedMs || null, rx: Date.now(),
    seeded: true, stale: book.stale || unanchored, depthLimited: false,
    bid: bids.map(([p, q]) => [String(p), String(q)]), ask: asks.map(([p, q]) => [String(p), String(q)]),
  };
}

