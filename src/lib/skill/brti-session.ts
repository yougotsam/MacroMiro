import { halfHourTape } from "./ta.ts";

export const FRESH_MS = 5_000;
export const VOL_MIN_CLOSES = 5;

/** Docs: this field exists only in the final minute. window_size 60 is the close tick. That window matches the 60 one-second prints. A smaller size is not the print. */
export function quarterSettlement(windowed: WindowPrint | null): number | null {
  if (!windowed || windowed.windowSize !== 60) return null;
  return windowed.value;
}

export type FeedStatus =
  | "connecting"
  | "live"
  | "stale"
  | "disconnected"
  | "malformed"
  | "unauthorized"
  | "reconnecting"
  | "mock"
  | "replay";

export type WindowPrint = {
  value: number;
  windowStart: number | null;
  windowEnd: number;
  windowSize: number | null;
};

export type RtiSymbol = "BRTI" | "ETHUSD_RTI" | "SOLUSD_RTI";

export type Observation = {
  symbol: RtiSymbol;
  source: "kalshi-cfbenchmarks_value";
  mode: "live" | "mock" | "replay";
  exchangeTs: number | null;
  receivedAt: number | null;
  localReceiptTs: number;
  trailing60: WindowPrint | null;
  windowed15: WindowPrint | null;
};

export type MinuteBar = { t: number; o: number; h: number; l: number; c: number; n: number; closed: boolean };

export type Session = {
  status: FeedStatus;
  sourceLabel: "none" | "kalshi-cfbenchmarks_value" | "fixture";
  mode: "none" | "live" | "mock" | "replay";
  seenLive: boolean;
  last: Observation | null;
  lastExchangeTs: number | null;
  lastReceiptTs: number | null;
  reconnects: number;
  malformed: number;
  subscriptions: number;
  subscribed: boolean;
  lastError: string;
  bars: MinuteBar[];
  gaps: number[];
  ignoredOutOfOrder: number;
  ignoredDuplicate: number;
  volBps: number | null;
};

type Win = { value?: string; window_size?: number; window_start_ts_ms?: number; window_end_ts_exclusive?: number };

export function emptySession(): Session {
  return {
    status: "disconnected",
    sourceLabel: "none",
    mode: "none",
    seenLive: false,
    last: null,
    lastExchangeTs: null,
    lastReceiptTs: null,
    reconnects: 0,
    malformed: 0,
    subscriptions: 0,
    subscribed: false,
    lastError: "",
    bars: [],
    gaps: [],
    ignoredOutOfOrder: 0,
    ignoredDuplicate: 0,
    volBps: null,
  };
}

function windowOf(raw: Win | undefined): WindowPrint | null {
  const value = Number(raw?.value);
  const end = raw?.window_end_ts_exclusive;
  if (!raw?.value || !Number.isFinite(value) || value <= 0 || !end) return null;
  return {
    value,
    windowStart: raw.window_start_ts_ms ?? null,
    windowEnd: end,
    windowSize: raw.window_size ?? null,
  };
}

export function controlFrame(raw: unknown): "value" | "ack" | "error" | "other" {
  const t = (raw as { type?: string })?.type;
  if (t === "cfbenchmarks_value") return "value";
  if (t === "subscribed" || t === "cfbenchmarks_value_indexlist" || t === "ok") return "ack";
  if (t === "error") return "error";
  return "other";
}

export function frameIndex(raw: unknown): string {
  const frame = raw as { msg?: { index_id?: unknown; data?: unknown } };
  const msg = frame?.msg ?? (raw as { index_id?: unknown; data?: unknown });
  if (typeof msg?.index_id === "string") return msg.index_id;
  if (typeof msg?.data === "string") {
    try {
      const inner = JSON.parse(msg.data) as { id?: string };
      return inner.id ?? "";
    } catch {
      return "";
    }
  }
  return "";
}

export function parseFrame(
  raw: unknown,
  localReceiptTs: number,
  mode: Observation["mode"] = "replay",
  symbol: RtiSymbol = "BRTI",
):
  | { ok: true; obs: Observation }
  | { ok: false; category: "malformed" | "unsupported-symbol" } {
  const frame = raw as { type?: string; msg?: Record<string, unknown> };
  const msg = frame?.msg ?? (raw as Record<string, unknown>);
  if (!msg || typeof msg !== "object") return { ok: false, category: "malformed" };
  const index = typeof msg.index_id === "string" ? msg.index_id : "";
  if (index && index !== symbol) return { ok: false, category: "unsupported-symbol" };
  if (!index && !msg.avg_60s_data && !msg.data) return { ok: false, category: "malformed" };
  let exchangeTs: number | null = null;
  if (typeof msg.data === "string") {
    try {
      const inner = JSON.parse(msg.data) as { time?: number; id?: string };
      if (inner.id && inner.id !== symbol) return { ok: false, category: "unsupported-symbol" };
      if (typeof inner.time === "number") exchangeTs = inner.time;
    } catch {
      return { ok: false, category: "malformed" };
    }
  }
  const trailing60 = windowOf(msg.avg_60s_data as Win | undefined);
  const windowed15 = windowOf(msg.last_60s_windowed_average_15min as Win | undefined);
  if (!trailing60 && !windowed15 && exchangeTs == null) return { ok: false, category: "malformed" };
  return {
    ok: true,
    obs: {
      symbol,
      source: "kalshi-cfbenchmarks_value",
      mode,
      exchangeTs: exchangeTs ?? trailing60?.windowEnd ?? null,
      receivedAt: typeof msg.received_at === "number" ? msg.received_at : null,
      localReceiptTs,
      trailing60,
      windowed15,
    },
  };
}

function pushPrint(session: Session, obs: Observation) {
  const ts = obs.exchangeTs;
  const px = obs.trailing60?.value;
  if (ts == null || px == null) return;
  const minute = Math.floor(ts / 60_000) * 60;
  const last = session.bars[session.bars.length - 1];
  if (last && ts < last.t * 1000) {
    session.ignoredOutOfOrder += 1;
    return;
  }
  if (last && last.t === minute) {
    if (last.c === px && obs.exchangeTs === session.lastExchangeTs) {
      session.ignoredDuplicate += 1;
      return;
    }
    last.h = Math.max(last.h, px);
    last.l = Math.min(last.l, px);
    last.c = px;
    last.n += 1;
    return;
  }
  if (last && minute > last.t + 60) {
    last.closed = true;
    for (let t = last.t + 60; t < minute; t += 60) session.gaps.push(t);
  } else if (last) {
    last.closed = true;
  }
  session.bars.push({ t: minute, o: px, h: px, l: px, c: px, n: 1, closed: false });
  if (session.bars.length > 240) session.bars.splice(0, session.bars.length - 240);
}

function realized(bars: MinuteBar[]) {
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

export function seedBars(session: Session, bars: MinuteBar[]): Session {
  const kept = bars.filter((b) => b && b.c > 0 && b.t > 0).slice(-240);
  if (!kept.length) return session;
  return { ...session, bars: kept, volBps: realized(kept) };
}

export function fold5(bars: MinuteBar[]) {
  const closed = bars.filter((b) => b.closed);
  const out: MinuteBar[] = [];
  for (let i = 0; i + 4 < closed.length; i += 1) {
    const g = closed.slice(i, i + 5);
    const consecutive = g.every((bar, n) => n === 0 || bar.t === g[n - 1].t + 60);
    if (!consecutive) continue;
    if ((g[0].t / 60) % 5 !== 0) continue;
    out.push({
      t: g[4].t,
      o: g[0].o,
      h: Math.max(...g.map((b) => b.h)),
      l: Math.min(...g.map((b) => b.l)),
      c: g[4].c,
      n: g.reduce((a, b) => a + b.n, 0),
      closed: true,
    });
    i += 4;
  }
  return out;
}

export function backoffMs(attempt: number, rand: () => number = Math.random) {
  const base = Math.min(30_000, 500 * 2 ** Math.max(0, attempt));
  return Math.round(base + rand() * 250);
}

export type SessionEvent =
  | { type: "connecting" }
  | { type: "unauthorized"; category: string }
  | { type: "subscribed" }
  | { type: "frame"; raw: unknown; mode: Observation["mode"] }
  | { type: "closed" }
  | { type: "tick" };

export function apply(session: Session, event: SessionEvent, now: number, symbol: RtiSymbol = "BRTI"): Session {
  const next: Session = { ...session, bars: session.bars.map((b) => ({ ...b })), gaps: [...session.gaps] };
  if (event.type === "connecting") {
    next.status = next.reconnects > 0 ? "reconnecting" : "connecting";
    next.subscribed = false;
    return next;
  }
  if (event.type === "unauthorized") {
    next.status = "unauthorized";
    next.lastError = event.category || "unauthorized";
    next.subscribed = false;
    return next;
  }
  if (event.type === "subscribed") {
    if (next.subscribed) return next;
    next.subscribed = true;
    next.subscriptions += 1;
    if (next.status === "connecting" || next.status === "reconnecting") next.status = "live";
    return next;
  }
  if (event.type === "closed") {
    next.status = "disconnected";
    next.subscribed = false;
    next.reconnects += 1;
    return next;
  }
  if (event.type === "tick") {
    if (next.lastReceiptTs != null && now - next.lastReceiptTs > FRESH_MS && next.status === "live") next.status = "stale";
    return next;
  }
  if (next.mode === "live" && event.mode !== "live") {
    next.lastError = "mock-rejected";
    return next;
  }
  const parsed = parseFrame(event.raw, now, event.mode, symbol);
  if (!parsed.ok) {
    next.malformed += 1;
    next.status = parsed.category === "unsupported-symbol" ? "malformed" : "malformed";
    next.lastError = parsed.category;
    return next;
  }
  const prevTs = next.lastExchangeTs;
  if (prevTs != null && parsed.obs.exchangeTs === prevTs && parsed.obs.trailing60?.value === next.last?.trailing60?.value) {
    next.ignoredDuplicate += 1;
    next.lastReceiptTs = now;
    return next;
  }
  next.last = parsed.obs;
  next.mode = event.mode;
  next.sourceLabel = event.mode === "live" ? "kalshi-cfbenchmarks_value" : "fixture";
  if (event.mode === "live") next.seenLive = true;
  pushPrint(next, parsed.obs);
  next.lastExchangeTs = parsed.obs.exchangeTs;
  next.lastReceiptTs = now;
  next.volBps = realized(next.bars);
  const age = parsed.obs.exchangeTs == null ? FRESH_MS + 1 : now - parsed.obs.exchangeTs;
  next.status = event.mode === "mock" ? "mock" : event.mode === "replay" ? "replay" : age > FRESH_MS ? "stale" : "live";
  return next;
}

export function publicStatus(session: Session, now: number, symbol: RtiSymbol = "BRTI") {
  const age = session.lastReceiptTs == null ? null : now - session.lastReceiptTs;
  const closed = session.bars.filter((b) => b.closed).length;
  const windowed = session.last?.windowed15 ?? null;
  const print = quarterSettlement(windowed);
  const settlement = print != null ? "print" : windowed ? "accumulating" : "absent";
  const settlementWhy =
    settlement === "print"
      ? "60-tick quarter close. This is the final-minute BRTI average. It is a price, not an order."
      : settlement === "accumulating"
        ? `Final minute is still filling (${windowed?.windowSize ?? "?"}/60). Not the settlement print.`
        : "The quarter-hour field is omitted outside the final minute. Absence is not a price.";
  const tape = halfHourTape(session.bars);
  return {
    source: session.sourceLabel,
    symbol,
    status: session.status,
    mode: session.mode,
    seenLive: session.seenLive,
    ageMs: age,
    lastExchangeTs: session.lastExchangeTs,
    lastReceiptTs: session.lastReceiptTs,
    trailing60: session.last?.trailing60?.value ?? null,
    windowed15: windowed?.value ?? null,
    reconnects: session.reconnects,
    malformed: session.malformed,
    subscriptions: session.subscriptions,
    lastError: session.lastError,
    closed1m: closed,
    bars5m: fold5(session.bars).length,
    gaps: session.gaps.length,
    volBps: session.volBps,
    volReady: session.volBps != null,
    bias30: tape.bias,
    push: tape.push,
    minutes: session.bars
      .filter((b) => b.closed && b.c > 0)
      .slice(-80)
      .map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c })),
    settlement,
    settlementValue: print,
    settlementWhy,
    healthy: session.seenLive && session.status === "live" && session.mode === "live",
  };
}
