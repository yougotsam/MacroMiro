/**
 * Record-only top of book for the last 90 seconds of each 15-minute window.
 * Does not import the order path. A slow book request is dropped, never queued, so this process cannot block the engine.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { kalshiWsHeaders } from "../src/lib/scan/kalshi-auth";
import { bestBid, impliedAsk } from "../src/lib/desk/book-snapshot";

const PUB = "https://api.elections.kalshi.com/trade-api/v2";
const WS_URL = "wss://api.elections.kalshi.com/trade-api/ws/v2";
const OUT = "/workspace/data/desk/book-90s.jsonl";
const WINDOW_S = 90;

const SERIES: Record<string, string> = {
  KXBTC15M: "BRTI",
  KXETH15M: "ETHUSD_RTI",
  KXSOL15M: "SOLUSD_RTI",
  KXXRP15M: "XRPUSD_RTI",
  KXDOGE15M: "DOGEUSD_RTI",
  KXGOLD15M: "Metal.Index.1OZGOLD/USD",
  KXSILVER15M: "Metal.Index.SILVER/USD",
  KXWTI15M: "Commodities.Index.PYTHOIL/USD",
  KXGBPUSD15M: "FX.GBP/USD",
  KXEURUSD15M: "FX.EUR/USD",
  KXUSDJPY15M: "FX.USD/JPY",
};
const RTI = ["BRTI", "ETHUSD_RTI", "SOLUSD_RTI", "XRPUSD_RTI", "DOGEUSD_RTI"];
const PYTH = ["Metal.Index.1OZGOLD/USD", "Metal.Index.SILVER/USD", "Commodities.Index.PYTHOIL/USD", "FX.GBP/USD", "FX.EUR/USD", "FX.USD/JPY"];

type Market = { series: string; ticker: string; closeMs: number };
type Idx = { exchangeTs: number; value: number; recvTs: number };

const markets: Market[] = [];
const index = new Map<string, Idx>();
let pulling = false;
let wsBackoff = 500;

function write(row: unknown) {
  mkdirSync("/workspace/data/desk", { recursive: true });
  appendFileSync(OUT, `${JSON.stringify(row)}\n`);
}

async function refreshMarkets() {
  const next: Market[] = [];
  await Promise.all(Object.keys(SERIES).map(async (series) => {
    try {
      const res = await fetch(`${PUB}/markets?series_ticker=${series}&status=open&limit=5`, { signal: AbortSignal.timeout(2_500) });
      if (!res.ok) return;
      const body = (await res.json()) as { markets?: Array<{ ticker?: string; close_time?: string }> };
      for (const m of body.markets ?? []) {
        const closeMs = Date.parse(String(m.close_time ?? ""));
        if (m.ticker && Number.isFinite(closeMs)) next.push({ series, ticker: m.ticker, closeMs });
      }
    } catch {
      /* next second tries again */
    }
  }));
  markets.length = 0;
  markets.push(...next);
}

async function oneBook(m: Market, left: number) {
  const recv = new Date().toISOString();
  const ix = index.get(SERIES[m.series]);
  let httpDate: string | null = null;
  let yes: ReturnType<typeof bestBid> = null;
  let no: ReturnType<typeof bestBid> = null;
  let http: number | null = null;
  try {
    const res = await fetch(`${PUB}/markets/${m.ticker}/orderbook?depth=1`, { signal: AbortSignal.timeout(1_500) });
    http = res.status;
    httpDate = res.headers.get("date");
    if (res.ok) {
      const body = (await res.json()) as { orderbook_fp?: { yes_dollars?: [string, string][]; no_dollars?: [string, string][] } };
      yes = bestBid(body.orderbook_fp?.yes_dollars);
      no = bestBid(body.orderbook_fp?.no_dollars);
    }
  } catch {
    http = 0;
  }
  const yesAsk = impliedAsk(no);
  const noAsk = impliedAsk(yes);
  write({
    recv,
    series: m.series,
    ticker: m.ticker,
    close: new Date(m.closeMs).toISOString(),
    seconds_left: Math.round(left),
    http,
    http_date: httpDate,
    book_exchange_ts: null,
    yes_bid: yes?.price ?? null,
    yes_bid_size: yes?.size ?? null,
    yes_ask: yesAsk?.price ?? null,
    yes_ask_size: yesAsk?.size ?? null,
    no_bid: no?.price ?? null,
    no_bid_size: no?.size ?? null,
    no_ask: noAsk?.price ?? null,
    no_ask_size: noAsk?.size ?? null,
    ask_source: "implied_by_opposite_bid",
    index: SERIES[m.series],
    index_value: ix?.value ?? null,
    index_exchange_ts: ix?.exchangeTs ?? null,
    index_recv_ts: ix?.recvTs ?? null,
  });
}

async function tick() {
  if (pulling) return;
  pulling = true;
  try {
    const now = Date.now();
    const due = markets.filter((m) => {
      const left = (m.closeMs - now) / 1000;
      return left >= 0 && left <= WINDOW_S;
    });
    await Promise.all(due.map((m) => oneBook(m, (m.closeMs - now) / 1000)));
  } finally {
    pulling = false;
  }
}

function openIndex() {
  let headers: Record<string, string>;
  try {
    headers = kalshiWsHeaders();
  } catch {
    setTimeout(openIndex, wsBackoff);
    wsBackoff = Math.min(15_000, wsBackoff * 2);
    return;
  }
  const ws = new WebSocket(WS_URL, { headers } as unknown as string[]);
  ws.onopen = () => {
    wsBackoff = 500;
    ws.send(JSON.stringify({ id: 1, cmd: "subscribe", params: { channels: ["cfbenchmarks_value"], index_ids: RTI } }));
    ws.send(JSON.stringify({ id: 2, cmd: "subscribe", params: { channels: ["pyth_value"], underlying_tickers: PYTH } }));
  };
  ws.onmessage = (ev) => {
    let msg: { type?: string; msg?: Record<string, unknown> };
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    const recvTs = Date.now();
    try {
      if (msg.type === "cfbenchmarks_value" && msg.msg) {
        const inner = JSON.parse(String(msg.msg.data)) as { time: number; id: string; value: string };
        if (inner.id && Number.isFinite(inner.time)) index.set(inner.id, { exchangeTs: inner.time, value: Number(inner.value), recvTs });
      } else if (msg.type === "pyth_value" && msg.msg) {
        const id = String(msg.msg.underlying_ticker);
        const exchangeTs = Number(msg.msg.source_ts_ms);
        const value = Number(msg.msg.value_usd);
        if (id && Number.isFinite(exchangeTs)) index.set(id, { exchangeTs, value, recvTs });
      }
    } catch {
      /* a bad print is skipped */
    }
  };
  ws.onclose = () => setTimeout(openIndex, wsBackoff);
  ws.onerror = () => {
    try { ws.close(); } catch { /* already closed */ }
  };
}

await refreshMarkets();
setInterval(() => void refreshMarkets(), 15_000);
setInterval(() => void tick(), 1_000);
openIndex();
void tick();
