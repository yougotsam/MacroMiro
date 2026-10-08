import { readTape } from "./indicators";
import { loadFfCalendar } from "./ff-calendar";
import type { AnalogLive } from "./empirical";
import { toIsoDate, unescapeHtml } from "./time";
import { tfOf } from "./tf";
import type { Bar, BookId, CalEvent, DeskPayload, Headline, SessionMap, Snapshot, Tape } from "./types";

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
const QUOTE_MS = 50_000;
const CONTEXT_MS = 180_000;

type Pack = { last: number; bars: Bar[]; asOf: string };
type Quotes = {
  btc: Pack | null;
  sol: Pack | null;
  eth: Pack | null;
  gold: Pack | null;
  xrp: Pack | null;
  silver: Pack | null;
  es: Pack | null;
  oil: Pack | null;
  vix: Pack | null;
  dxy: Pack | null;
  fng: { value: number; label: string } | null;
  btcVenue: string;
  solVenue: string;
  ethVenue: string;
};

type Context = { calendar: CalEvent[]; wire: Headline[] };
let quotesCache: { at: number; data: Quotes } | null = null;
let contextCache: { at: number; data: Context } | null = null;

export function bustDeskCache() {
  quotesCache = null;
  contextCache = null;
}

async function grab(url: string, timeout = 8_000): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "application/json, application/xml, text/xml, */*" },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function grabJson<T>(url: string): Promise<T | null> {
  const text = await grab(url);
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function etParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    iso: `${get("year")}-${get("month")}-${get("day")}`,
    h: Number(get("hour")) + Number(get("minute")) / 60,
    w: get("weekday"),
  };
}

function sessionMap(now = new Date()): SessionMap {
  const { iso, h, w } = etParts(now);
  const labor = iso === "2026-09-07";
  const weekend = w === "Sat" || w === "Sun";
  const cash: SessionMap["cash"] = labor || weekend || h < 9.5 || h >= 16 ? "closed" : "open";
  let globex: SessionMap["globex"] = "closed";
  if (!weekend) {
    if (labor) {
      globex = h >= 18 || h < 13 ? "open" : "halt";
    } else if (h >= 18 || h < 17) {
      globex = "open";
    }
  }
  let note = "Thin hours.";
  if (labor && globex === "open") {
    note = "NYSE/Nasdaq closed for Labor Day. CME globex is back open for Tuesday's trade date. BTC trades.";
  } else if (labor) {
    note = "NYSE/Nasdaq closed for Labor Day. CME equity futures halted 13:00–18:00 ET. BTC trades.";
  } else if (cash === "open") {
    note = "Cash RTH is live.";
  } else if (globex === "open") {
    note = "Cash closed. Globex is open.";
  }
  return { cash, globex, crypto: "open", note, holiday: labor ? "US Labor Day" : undefined };
}

function parseRss(xml: string, source: string, limit = 6): Headline[] {
  const items = xml.split(/<item[\s>]/i).slice(1);
  const out: Headline[] = [];
  for (const item of items) {
    const title = unescapeHtml(decode(tag(item, "title")).replace(/<!\[CDATA\[|\]\]>/g, ""));
    if (!title || title === source || /^(Google News|Yahoo Finance|CoinDesk:|FRB:|Today in Energy|US Top News)/i.test(title))
      continue;
    const link = decode(tag(item, "link") || attr(item, "link") || tag(item, "guid")).replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    const pub = toIsoDate(tag(item, "pubDate") || tag(item, "published") || tag(item, "updated"));
    out.push({
      id: `${source}-${pub ?? out.length}-${title.slice(0, 28)}`,
      title,
      source,
      url: link,
      published: pub,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function mergeWire(rows: Headline[]) {
  const seen = new Set<string>();
  const uniq = rows.filter((h) => {
    const k = h.title.toLowerCase().slice(0, 80);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  uniq.sort((a, b) => Date.parse(b.published ?? "0") - Date.parse(a.published ?? "0"));
  const fresh = uniq.filter((h) => {
    if (!h.published) return false;
    return Date.now() - Date.parse(h.published) < 5 * 864e5;
  });
  return (fresh.length >= 4 ? fresh : uniq).slice(0, 8);
}

function tag(block: string, name: string) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m?.[1]?.trim() ?? "";
}
function attr(block: string, name: string) {
  const m = block.match(new RegExp(`<${name}[^>]*href="([^"]+)"`, "i"));
  return m?.[1] ?? "";
}
function decode(s: string) {
  return s
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/'/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/"/g, '"')
    .replace(/<[^>]+>/g, "")
    .trim();
}

type Bq = {
  id: string;
  time: string;
  countryCode: string;
  currency: string;
  name: string;
  importance: string;
  forecast: number | string | null;
  previous: number | string | null;
  actual: number | string | null;
  sourceUrl: string | null;
};

function mapCal(rows: Bq[]): CalEvent[] {
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      time: r.time,
      country: r.countryCode,
      currency: r.currency,
      importance: r.importance,
      forecast: r.forecast,
      previous: r.previous,
      actual: r.actual,
      sourceUrl: r.sourceUrl,
    }))
    .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}

function changePct(bars: Bar[], last: number): number | null {
  if (bars.length < 2) return null;
  const prev = bars[bars.length - 2]?.c;
  if (!prev) return null;
  return ((last - prev) / prev) * 100;
}

function dailyChange(bars: Bar[], last: number): number | null {
  if (!bars.length) return null;
  const start = bars[0]?.c;
  if (!start) return null;
  return ((last - start) / start) * 100;
}

export async function loadDesk(force = false): Promise<DeskPayload> {
  const now = new Date();
  const [quotes, context, analogs] = await Promise.all([loadQuotes(force), loadContext(force), loadAnalogs(force)]);
  return assemble(now, quotes, context, analogs);
}

const priorPacks = new Map<string, { at: number; bars: Bar[] }>();

function barsFromSticks(raw: Record<string, unknown>[] | undefined): Bar[] {
  const bars: Bar[] = [];
  for (const c of raw ?? []) {
    const price = c.price as { open_dollars?: string; close_dollars?: string; high_dollars?: string; low_dollars?: string } | undefined;
    const o = Number(price?.open_dollars ?? 0);
    const h = Number(price?.high_dollars ?? 0);
    const l = Number(price?.low_dollars ?? 0);
    const close = Number(price?.close_dollars ?? 0);
    if (!close) continue;
    bars.push({ t: Number(c.end_period_ts) * 1000, o, h, l, c: close, v: Number(c.volume_fp ?? 0) });
  }
  return bars;
}

function bucketBars(bars: Bar[], minutes: number): Bar[] {
  if (minutes <= 1) return bars;
  const ms = minutes * 60_000;
  const groups = new Map<number, Bar>();
  for (const bar of bars) {
    const key = Math.floor(bar.t / ms) * ms;
    const got = groups.get(key);
    if (!got) groups.set(key, { ...bar, t: key });
    else {
      got.h = Math.max(got.h, bar.h);
      got.l = Math.min(got.l, bar.l);
      got.c = bar.c;
      got.v += bar.v;
    }
  }
  return [...groups.values()].sort((a, b) => a.t - b.t);
}

async function priorPack(series: string): Promise<Bar[]> {
  const hit = priorPacks.get(series);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.bars;
  const now = Math.floor(Date.now() / 1000);
  const list = await grabJson<{ markets?: { ticker?: string }[] }>(
    `https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=${series}&status=settled&limit=8`,
  );
  const tickers = (list?.markets ?? []).map((m) => m.ticker).filter((t): t is string => !!t);
  const chunks = await Promise.all(
    tickers.map((ticker) =>
      grabJson<{ candlesticks?: Record<string, unknown>[] }>(
        `https://api.elections.kalshi.com/trade-api/v2/series/${series}/markets/${ticker}/candlesticks?start_ts=${now - 6 * 3600}&end_ts=${now}&period_interval=1`,
      ),
    ),
  );
  const bars = chunks.flatMap((sticks) => barsFromSticks(sticks?.candlesticks)).sort((a, b) => a.t - b.t);
  if (bars.length >= 14) priorPacks.set(series, { at: Date.now(), bars });
  return bars;
}

async function kalshiPack(series: string): Promise<Pack | null> {
  const list = await grabJson<{ markets?: { ticker?: string; last_price_dollars?: string; yes_ask_dollars?: string }[] }>(
    `https://api.elections.kalshi.com/trade-api/v2/markets?series_ticker=${series}&status=open&limit=1`,
  );
  const market = list?.markets?.[0];
  if (!market?.ticker) return null;
  const now = Math.floor(Date.now() / 1000);
  const [sticks, prior] = await Promise.all([
    grabJson<{ candlesticks?: Record<string, unknown>[] }>(
      `https://api.elections.kalshi.com/trade-api/v2/series/${series}/markets/${market.ticker}/candlesticks?start_ts=${now - 3600}&end_ts=${now}&period_interval=1`,
    ),
    priorPack(series),
  ]);
  const byTime = new Map<number, Bar>();
  for (const bar of [...prior, ...barsFromSticks(sticks?.candlesticks)]) byTime.set(bar.t, bar);
  const bars = [...byTime.values()].sort((a, b) => a.t - b.t).slice(-240);
  const last = Number(market.last_price_dollars || market.yes_ask_dollars || bars.at(-1)?.c || 0);
  if (!last) return null;
  return { last, bars, asOf: new Date().toISOString() };
}

async function loadQuotes(force: boolean): Promise<Quotes> {
  if (!force && quotesCache && Date.now() - quotesCache.at < QUOTE_MS) return quotesCache.data;
  const [btc, eth, sol, gold, xrp] = await Promise.all([
    kalshiPack("KXBTC15M"),
    kalshiPack("KXETH15M"),
    kalshiPack("KXSOL15M"),
    kalshiPack("KXGOLD15M"),
    kalshiPack("KXXRP15M"),
  ]);
  const data: Quotes = {
    btc,
    sol,
    eth,
    gold,
    xrp,
    silver: null,
    es: null,
    oil: null,
    vix: null,
    dxy: null,
    fng: null,
    btcVenue: "Kalshi",
    solVenue: "Kalshi",
    ethVenue: "Kalshi",
  };
  const merged = stitchQuotes(quotesCache?.data ?? null, data);
  quotesCache = { at: Date.now(), data: merged };
  return merged;
}

function stitchQuotes(prev: Quotes | null, next: Quotes): Quotes {
  if (!prev) return next;
  const pack = (a: Pack | null, b: Pack | null) => (b && b.last ? b : a);
  return {
    btc: pack(prev.btc, next.btc),
    sol: pack(prev.sol, next.sol),
    eth: pack(prev.eth, next.eth),
    gold: pack(prev.gold, next.gold),
    xrp: pack(prev.xrp, next.xrp),
    silver: pack(prev.silver, next.silver),
    es: pack(prev.es, next.es),
    oil: pack(prev.oil, next.oil),
    vix: pack(prev.vix, next.vix),
    dxy: pack(prev.dxy, next.dxy),
    fng: next.fng ?? prev.fng,
    btcVenue: next.btc?.last ? next.btcVenue : prev.btcVenue,
    solVenue: next.sol?.last ? next.solVenue : prev.solVenue,
    ethVenue: next.eth?.last ? next.ethVenue : prev.ethVenue,
  };
}


async function loadContext(force: boolean): Promise<Context> {
  if (!force && contextCache && Date.now() - contextCache.at < CONTEXT_MS) return contextCache.data;
  const now = new Date();
  const from = now.toISOString().slice(0, 10);
  const to = new Date(now.getTime() + 14 * 864e5).toISOString().slice(0, 10);
  const [cal, ff, fed, cd, cnbc, gnews] = await Promise.all([
    grabJson<Bq[]>(`https://biquote.io/api/calendar?importance=high&countries=US,EU,GB,JP&from=${from}&to=${to}`),
    loadFfCalendar(grab),
    grab("https://www.federalreserve.gov/feeds/press_all.xml"),
    grab("https://www.coindesk.com/arc/outboundfeeds/rss/"),
    grab("https://www.cnbc.com/id/100003114/device/rss/rss.html"),
    grab(
      "https://news.google.com/rss/search?q=Federal+Reserve+OR+FOMC+OR+CPI+OR+bitcoin+OR+gold+OR+crude+oil+OR+solana&hl=en-US&gl=US&ceid=US:en",
    ),
  ]);
  const mapped = mapCal(cal ?? []);
  const seen = new Set(mapped.map((e) => `${e.name}|${e.time.slice(0, 13)}`));
  for (const e of ff) {
    const k = `${e.name}|${e.time.slice(0, 13)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    mapped.push(e);
  }
  mapped.sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
  const calendar = mapped.filter((e) => new Date(e.time).getTime() > now.getTime() - 2 * 36e5);
  const wire = mergeWire([
    ...(cd ? parseRss(cd, "CoinDesk") : []),
    ...(cnbc ? parseRss(cnbc, "CNBC") : []),
    ...(gnews ? parseRss(gnews, "Markets") : []),
    ...(fed ? parseRss(fed, "Federal Reserve", 3) : []),
  ]);
  const data = { calendar, wire };
  contextCache = { at: Date.now(), data };
  return data;
}

async function loadAnalogs(_force: boolean): Promise<AnalogLive[]> {
  return [];
}

function assemble(now: Date, quotes: Quotes, context: Context, analogs: AnalogLive[]): DeskPayload {
  const session = sessionMap(now);
  const calendar = context.calendar;
  const next = calendar.find((e) => new Date(e.time).getTime() > now.getTime()) ?? null;
  const hoursToNext = next ? (new Date(next.time).getTime() - now.getTime()) / 36e5 : null;
  const snapshot: Snapshot = {
    btc: quotes.btc?.last ?? 0,
    sol: quotes.sol?.last ?? 0,
    gold: quotes.gold?.last ?? 0,
    es: quotes.es?.last ?? 0,
    oil: quotes.oil?.last ?? 0,
    vix: quotes.vix?.last ?? null,
    dxy: quotes.dxy?.last ?? null,
    fng: quotes.fng?.value ?? null,
    fngLabel: quotes.fng?.label ?? null,
  };

  const red = /CPI|FOMC|NFP|Payroll|EIA Crude|ECB Interest|ECB Deposit|BoJ Rate|Fed/i;
  const nextIsRed = !!(next && red.test(next.name));
  let heat = 24;
  if (nextIsRed && hoursToNext != null && hoursToNext < 48 && hoursToNext > 0) heat = 52;
  if (nextIsRed && hoursToNext != null && hoursToNext < 12 && hoursToNext > 0) heat = 74;
  if (snapshot.vix && snapshot.vix > 20) heat += 8;
  if (snapshot.fng != null && (snapshot.fng >= 70 || snapshot.fng <= 30)) heat += 6;
  if (session.cash === "closed" && session.globex !== "open") heat = Math.min(heat, 34);
  heat = Math.max(8, Math.min(92, heat));
  const mk = (id: BookId, symbol: string, venue: string, pack: Pack | null): Tape => {
    const bars = pack?.bars.slice(-60) ?? [];
    const last = pack?.last ?? 0;
    return readTape(id, symbol, venue, bars, last, dailyChange(bars, last) ?? changePct(bars, last), pack?.asOf ?? now.toISOString());
  };
  return {
    asOf: quotesCache?.at ? new Date(quotesCache.at).toISOString() : now.toISOString(),
    session,
    heat,
    snapshot,
    next,
    hoursToNext,
    calendar: calendar.slice(0, 18),
    wire: context.wire,
    analogs,
    tapes: {
      btc: mk("btc", "KXBTC15M", "Kalshi", quotes.btc),
      sol: mk("sol", "KXSOL15M", "Kalshi", quotes.sol),
      eth: mk("eth", "KXETH15M", "Kalshi", quotes.eth),
      gold: mk("gold", "KXGOLD15M", "Kalshi", quotes.gold),
      xrp: mk("xrp", "KXXRP15M", "Kalshi", quotes.xrp),
      silver: mk("silver", "none", "not this desk", null),
      es: mk("es", "none", "not this desk", null),
      oil: mk("oil", "none", "not this desk", null),
    },
    sources: [
      { name: "Kalshi", url: "https://api.elections.kalshi.com/trade-api/v2" },
      { name: "Forex Factory calendar", url: "https://www.forexfactory.com/calendar" },
      { name: "biquote calendar", url: "https://biquote.io/api/calendar" },
      { name: "Federal Reserve RSS", url: "https://www.federalreserve.gov/feeds/press_all.xml" },
    ],
  };
}

const BOOK_SERIES: Partial<Record<BookId, string>> = {
  btc: "KXBTC15M",
  eth: "KXETH15M",
  sol: "KXSOL15M",
  gold: "KXGOLD15M",
  xrp: "KXXRP15M",
};

export async function loadTape(book: BookId, tfId: string): Promise<Tape> {
  const series = BOOK_SERIES[book];
  if (!series) return readTape(book, book, "not this desk", [], 0, null, new Date().toISOString());
  const pack = await kalshiPack(series);
  const minutes = Math.max(1, Math.round(tfOf(tfId).cb / 60));
  const bars = bucketBars(pack?.bars ?? [], minutes);
  const last = pack?.last ?? 0;
  const start = bars[0]?.c;
  const changePct = start ? ((last - start) / start) * 100 : null;
  return readTape(book, series, "Kalshi", bars, last, changePct, pack?.asOf ?? new Date().toISOString());
}

const SPOT: Partial<Record<BookId, { coinbase?: string; yahoo?: string }>> = {
  btc: { coinbase: "BTC-USD" },
  eth: { coinbase: "ETH-USD" },
  sol: { coinbase: "SOL-USD" },
  xrp: { coinbase: "XRP-USD" },
  gold: { yahoo: "GC=F" },
};

/** The coin or the metal. Not the 0–1 ticket. The chart uses this. The order does not. */
export async function loadSpot(book: BookId, tfId: string): Promise<Tape> {
  const spec = SPOT[book];
  const tf = tfOf(tfId);
  const now = new Date().toISOString();
  if (!spec) return readTape(book, book, "no spot", [], 0, null, now);
  const bars = spec.coinbase ? await coinbaseBars(spec.coinbase, tf.cb) : await yahooBars(spec.yahoo!, tf.yahoo, tf.range);
  const last = bars.at(-1)?.c ?? 0;
  const start = bars[0]?.c;
  const change = start ? ((last - start) / start) * 100 : null;
  return readTape(book, spec.coinbase ?? spec.yahoo ?? book, spec.coinbase ? "Coinbase" : "Yahoo", bars, last, change, now);
}

async function coinbaseBars(product: string, granularity: number): Promise<Bar[]> {
  const allowed = [60, 300, 900, 3600, 21600, 86400];
  const g = allowed.includes(granularity) ? granularity : 900;
  const res = await fetch(`https://api.exchange.coinbase.com/products/${product}/candles?granularity=${g}`, {
    signal: AbortSignal.timeout(8000),
    headers: { accept: "application/json", "user-agent": UA },
  });
  if (!res.ok) return [];
  const rows = (await res.json()) as [number, number, number, number, number, number][];
  if (!Array.isArray(rows)) return [];
  return rows
    .map(([t, low, high, open, close, volume]) => ({ t: t * 1000, o: open, h: high, l: low, c: close, v: volume }))
    .filter((b) => b.c > 0 && b.l > 0 && b.h >= b.l)
    .sort((a, b) => a.t - b.t)
    .slice(-180);
}

async function yahooBars(symbol: string, interval: string, range: string): Promise<Bar[]> {
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`, {
    signal: AbortSignal.timeout(8000),
    headers: { "user-agent": UA },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { open?: number[]; high?: number[]; low?: number[]; close?: number[]; volume?: number[] }[] } }[] };
  };
  const row = json.chart?.result?.[0];
  const ts = row?.timestamp ?? [];
  const q = row?.indicators?.quote?.[0];
  if (!q?.close) return [];
  const bars: Bar[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close[i];
    const o = q.open?.[i] ?? c;
    const h = q.high?.[i] ?? c;
    const l = q.low?.[i] ?? c;
    if (c == null || !Number.isFinite(c) || c <= 0) continue;
    bars.push({ t: ts[i] * 1000, o, h, l, c, v: q.volume?.[i] ?? 0 });
  }
  return bars.slice(-180);
}




