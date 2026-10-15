/**
 * Kalshi perps collector (READ-ONLY). One authenticated WebSocket to the margin WS host:
 *   channels ticker (bid/ask/size, mark, liquidation mark, reference price, funding rate/next time),
 *   trade (public prints) and orderbook_delta (snapshot + deltas, seq-checked), for the dynamic registry.
 * REST every 60 s: exchange status, balance, risk parameters. Builds 1m/5m/15m candles from trades.
 * Writes JSONL under $DATA_ROOT/perps/stream/YYYY-MM-DD/. book.jsonl is the lossless snapshot/delta/gap/reconnect log.
 * Raw archives stay out of git. No order endpoints are referenced.
 *   bun scripts/perps/collect.ts [--seconds N]
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { kalshiSignedHeaders } from "../../src/lib/scan/kalshi-auth";
import { perpsReader, signedGet } from "../../src/lib/perps/kalshi-perps-read";
import { CandleBuilder, LocalBook, SeqTracker, eligibleMarkets, type TradeMsg } from "../../src/lib/perps/stream";
import { DATA_ROOT } from "../../src/lib/data-root";

const WS_HOST = process.env.KALSHI_PERPS_WS || "wss://external-api-margin-ws.kalshi.com";
const WS_PATH = "/trade-api/ws/v2/margin";
const secArg = process.argv.indexOf("--seconds"); const runFor = secArg > 0 ? Number(process.argv[secArg + 1]) * 1000 : Infinity;
const R = perpsReader();
const day = () => new Date().toISOString().slice(0, 10);
const dir = () => { const d = `${DATA_ROOT}/perps/stream/${day()}`; mkdirSync(d, { recursive: true }); return d; };
const out = (f: string, o: unknown) => appendFileSync(`${dir()}/${f}.jsonl`, JSON.stringify(o) + "\n");
const tickers = eligibleMarkets(await R.markets()).slice(0, 12);
const books = new Map(tickers.map((t) => [t, new LocalBook()]));
const builders = new Map(tickers.map((t) => [t, [60_000, 300_000, 900_000].map((p) => new CandleBuilder(p))]));
const stats = { started: new Date().toISOString(), tickers, msgs: 0, trades: 0, tickerMsgs: 0, deltas: 0, gaps: 0, resyncs: 0, reconnects: 0, bars: 0, lastMsgMs: 0, rest: {} as Record<string, unknown> };
const statusFile = `${DATA_ROOT}/perps/collector-status.json`;
let id = 1; let seq = new SeqTracker(); let ws: WebSocket | null = null;

function subscribe(chs: string[], extra: Record<string, unknown> = {}) { ws?.send(JSON.stringify({ id: id++, cmd: "subscribe", params: { channels: chs, market_tickers: tickers, ...extra } })); }
function connect() {
  ws = new WebSocket(`${WS_HOST}${WS_PATH}`, { headers: kalshiSignedHeaders("GET", WS_PATH) } as never);
  ws.onopen = () => { seq = new SeqTracker(); subscribe(["ticker"]); subscribe(["trade"]); subscribe(["orderbook_delta"], { send_initial_snapshot: true }); };
  ws.onmessage = (ev) => {
    stats.msgs++; stats.lastMsgMs = Date.now();
    const m = JSON.parse(String(ev.data)) as { type: string; seq?: number; msg?: any };
    const sid = (m as { sid?: number }).sid;
    if ((m.type === "orderbook_snapshot" || m.type === "orderbook_delta") && sid != null && !seq.ok(sid, m.seq!)) {
      stats.gaps++;
      out("book", { kind: "seq_gap", sid, seq: m.seq ?? null, venueTs: null, rx: Date.now() });
      for (const b of books.values()) b.stale = true;
      resync();
      return;
    }
    if (m.type === "orderbook_snapshot") {
      out("book", { kind: "orderbook_snapshot", market_ticker: m.msg?.market_ticker, sid: sid ?? null, seq: m.seq ?? null, venueTs: m.msg?.ts_ms ?? null, rx: Date.now(), bid: m.msg?.bid, ask: m.msg?.ask });
      books.get(m.msg.market_ticker)?.snapshot(m.msg, m.seq!);
    } else if (m.type === "orderbook_delta") {
      stats.deltas++;
      out("book", { kind: "orderbook_delta", market_ticker: m.msg?.market_ticker, sid: sid ?? null, seq: m.seq ?? null, venueTs: m.msg?.ts_ms ?? null, rx: Date.now(), price: m.msg?.price, delta: m.msg?.delta, side: m.msg?.side });
      books.get(m.msg.market_ticker)?.delta(m.msg);
    } else if (m.type === "ticker") { stats.tickerMsgs++; const x = m.msg; out("ticker", { t: x.ts_ms, rx: Date.now(), k: x.market_ticker, bid: x.bid, ask: x.ask, bs: x.bid_size_fp, as: x.ask_size_fp, px: x.price, mark: x.settlement_mark_price, liqMark: x.liquidation_mark_price, ref: x.reference_price, funding: x.funding_rate, oi: x.open_interest_notional_value_dollars }); }
    else if (m.type === "trade") {
      stats.trades++; const t = m.msg as TradeMsg; out("trades", { ...t, rx: Date.now() });
      for (const b of builders.get(t.market_ticker) ?? []) for (const bar of b.add(t)) { stats.bars++; out(`bars-${b.periodMs / 60_000}m`, { k: t.market_ticker, ...bar }); }
    } else if (m.type === "error") out("errors", m);
  };
  ws.onclose = () => { stats.reconnects++; out("book", { kind: "reconnect", sid: null, seq: null, venueTs: null, rx: Date.now() }); for (const b of books.values()) b.stale = true; setTimeout(connect, 2_000); };
  ws.onerror = () => { /* onclose follows */ };
}
let resyncing = false;
function resync() { if (resyncing) return; resyncing = true; stats.resyncs++; ws?.close(); setTimeout(() => (resyncing = false), 3_000); }
connect();

async function restTick() {
  try {
    const [status, bal, risk] = await Promise.all([R.exchangeStatus(), signedGet("/balance") as Promise<any>, signedGet("/risk_parameters") as Promise<any>]);
    stats.rest = { at: new Date().toISOString(), status, balance: bal?.subaccount_balances?.map((s: any) => ({ sub: s.subaccount, equity: s.account_equity, avail: s.available_balance })), liqThreshold: risk.liquidation_margin_ratio_threshold };
    out("rest", stats.rest);
  } catch (e) { out("errors", { at: Date.now(), rest: String(e).slice(0, 200) }); }
  const now = Date.now();
  for (const [k, bs] of builders) for (const b of bs) for (const bar of b.flush(now)) { stats.bars++; out(`bars-${b.periodMs / 60_000}m`, { k, ...bar }); }
  const tops = Object.fromEntries([...books].map(([t, b]) => [t, { ...b.top(3), stale: b.stale, ageMs: now - b.updatedMs }]));
  writeFileSync(statusFile, JSON.stringify({ ...stats, books: tops, now: new Date(now).toISOString() }, null, 1));
}
await restTick();
const iv = setInterval(restTick, 60_000);
setTimeout(() => { clearInterval(iv); void restTick().then(() => { ws?.close(); process.exit(0); }); }, Number.isFinite(runFor) ? runFor : 2 ** 31 - 1);
