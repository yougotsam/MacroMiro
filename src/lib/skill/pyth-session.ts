import { halfHourTape } from "./ta.ts";

/** KXGOLD15M settles on Pyth Metal.Index.1OZGOLD/USD (series settlement source). */
export const XAU_TICKER = "Metal.Index.1OZGOLD/USD";
export const FRESH_MS = 15_000;
export const VOL_MIN_CLOSES = 5;

export type PythStatus =
  | "connecting"
  | "live"
  | "stale"
  | "disconnected"
  | "malformed"
  | "unauthorized"
  | "reconnecting";

export type XauMinute = { t: number; o: number; h: number; l: number; c: number; closed: boolean };

export type XauSession = {
  status: PythStatus;
  seenLive: boolean;
  last: number | null;
  lastTs: number | null;
  lastReceipt: number | null;
  bars: XauMinute[];
  malformed: number;
  reconnects: number;
  subscriptions: number;
  lastError: string;
};

export function emptyXau(): XauSession {
  return {
    status: "disconnected",
    seenLive: false,
    last: null,
    lastTs: null,
    lastReceipt: null,
    bars: [],
    malformed: 0,
    reconnects: 0,
    subscriptions: 0,
    lastError: "",
  };
}

export function seedXau(session: XauSession, bars: XauMinute[]): XauSession {
  const kept = bars.filter((b) => b && b.c > 0 && b.t > 0).slice(-240);
  if (!kept.length) return session;
  return { ...session, bars: kept };
}

export function controlPyth(raw: unknown): "value" | "ack" | "error" | "other" {
  const t = (raw as { type?: string })?.type;
  if (t === "pyth_value") return "value";
  if (t === "subscribed" || t === "ok") return "ack";
  if (t === "error") return "error";
  return "other";
}

export function parsePyth(
  raw: unknown,
): { ok: true; px: number; ts: number; symbol: string } | { ok: false; category: "malformed" | "other-symbol" } {
  const frame = raw as { type?: string; msg?: Record<string, unknown> };
  const msg = frame?.msg ?? (raw as Record<string, unknown>);
  if (!msg || typeof msg !== "object") return { ok: false, category: "malformed" };
  const symbol = typeof msg.underlying_ticker === "string" ? msg.underlying_ticker : "";
  if (symbol && symbol !== XAU_TICKER) return { ok: false, category: "other-symbol" };
  const px = Number(msg.value_usd);
  const ts = typeof msg.source_ts_ms === "number" ? msg.source_ts_ms : null;
  if (!symbol || !Number.isFinite(px) || px <= 0 || ts == null) return { ok: false, category: "malformed" };
  return { ok: true, px, ts, symbol };
}

function pushTick(session: XauSession, ts: number, px: number) {
  const minute = Math.floor(ts / 60_000) * 60;
  const last = session.bars[session.bars.length - 1];
  if (last && ts < last.t * 1000) return;
  if (last && last.t === minute) {
    last.h = Math.max(last.h, px);
    last.l = Math.min(last.l, px);
    last.c = px;
    return;
  }
  if (last) last.closed = true;
  session.bars.push({ t: minute, o: px, h: px, l: px, c: px, closed: false });
  if (session.bars.length > 240) session.bars.splice(0, session.bars.length - 240);
}

function volOf(bars: XauMinute[]) {
  const closed = bars.filter((b) => b.closed);
  if (closed.length < VOL_MIN_CLOSES + 1) return null;
  const rets: number[] = [];
  for (let i = 1; i < closed.length; i += 1) {
    const prev = closed[i - 1];
    if (!prev || closed[i].t !== prev.t + 60) continue;
    rets.push((closed[i].c - prev.c) / prev.c);
  }
  if (rets.length < VOL_MIN_CLOSES) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const v = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(v) * 10_000;
}

export type XauEvent =
  | { type: "connecting" }
  | { type: "unauthorized"; category: string }
  | { type: "subscribed" }
  | { type: "tick"; px: number; ts: number }
  | { type: "bad" }
  | { type: "closed" }
  | { type: "clock" };

export function applyXau(session: XauSession, event: XauEvent, now: number): XauSession {
  const next: XauSession = { ...session, bars: session.bars.map((b) => ({ ...b })) };
  if (event.type === "connecting") {
    next.status = next.reconnects > 0 ? "reconnecting" : "connecting";
    return next;
  }
  if (event.type === "unauthorized") {
    next.status = "unauthorized";
    next.lastError = event.category || "unauthorized";
    return next;
  }
  if (event.type === "subscribed") {
    next.subscriptions += 1;
    if (next.status === "connecting" || next.status === "reconnecting" || next.status === "disconnected") next.status = "live";
    return next;
  }
  if (event.type === "closed") {
    next.status = "disconnected";
    next.reconnects += 1;
    return next;
  }
  if (event.type === "clock") {
    if (next.lastReceipt != null && now - next.lastReceipt > FRESH_MS && next.status === "live") next.status = "stale";
    return next;
  }
  if (event.type === "bad") {
    next.malformed += 1;
    next.lastError = "malformed";
    return next;
  }
  pushTick(next, event.ts, event.px);
  next.last = event.px;
  next.lastTs = event.ts;
  next.lastReceipt = now;
  next.seenLive = true;
  next.status = now - event.ts > FRESH_MS ? "stale" : "live";
  return next;
}

/** The contract wants a finished 1-minute close, never the tick that is still printing. */
export function lastCandleClose(session: XauSession): number | null {
  const closed = session.bars.filter((b) => b.closed);
  const bar = closed[closed.length - 1];
  return bar ? bar.c : null;
}

export function xauStatus(session: XauSession, now: number) {
  const age = session.lastReceipt == null ? null : now - session.lastReceipt;
  const close = lastCandleClose(session);
  const tape = halfHourTape(session.bars);
  return {
    source: "kalshi-pyth_value" as const,
    symbol: XAU_TICKER,
    status: session.status,
    seenLive: session.seenLive,
    ageMs: age,
    spot: session.last,
    candleClose: close,
    closedMinutes: session.bars.filter((b) => b.closed).length,
    volBps: volOf(session.bars),
    bias30: tape.bias,
    push: tape.push,
    minutes: session.bars
      .filter((b) => b.closed && b.c > 0)
      .slice(-80)
      .map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c })),
    malformed: session.malformed,
    reconnects: session.reconnects,
    subscriptions: session.subscriptions,
    lastError: session.lastError,
    settlement: close == null ? ("absent" as const) : ("last-close" as const),
    settlementWhy:
      close == null
        ? "No finished XAU minute yet. The live tick is not the candle the gold contract settles on."
        : "Last finished 1-minute XAU close. The contract uses the minute that ends on the window, not the chart and not the still-open tick.",
    healthy: session.seenLive && session.status === "live" && age != null && age <= FRESH_MS,
  };
}
