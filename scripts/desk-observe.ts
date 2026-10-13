/**
 * Read-only observation collector (see src/lib/desk/observe.ts). Separate process from the engine; cannot send orders.
 *   DESK_DATA_DIR=/workspace/data/desk-observe nohup bun scripts/desk-observe.ts >> /workspace/data/desk-observe/observe.log 2>&1 &
 * Stop: kill $(cat /workspace/data/desk-observe/observe.pid)
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { installReadOnlyFetch } from "../src/lib/desk/net-guard";
import { dataDir } from "../src/lib/desk/config";
import { Collector } from "../src/lib/desk/observe";
import { Feeds } from "../src/lib/desk/feeds";
import { MoveGuard } from "../src/lib/desk/guard";
import { eventFee, exchangeStatus, marketResult, openMarket } from "../src/lib/desk/kalshi-read";
import { fetchPublicTrades, parseCoinbaseCandles, PUBLIC_HOST } from "../src/lib/desk/market-data";

// 1. GET-only network for the whole process, before anything else runs
const net = installReadOnlyFetch();

// 2. never share the engine's data dir (journal, risk state, prints)
const dir = dataDir();
if (!process.env.DESK_DATA_DIR || dir === "/workspace/data/desk") {
  console.error("refusing to start: set DESK_DATA_DIR to a dedicated observation dir (not the engine's /workspace/data/desk)");
  process.exit(2);
}
mkdirSync(dir, { recursive: true });
const lock = `${dir}/observe.pid`;
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, "utf8").trim());
  try {
    if (pid && pid !== process.pid) {
      process.kill(pid, 0);
      console.error(`collector already running (pid ${pid})`);
      process.exit(3);
    }
  } catch {
    /* stale lock */
  }
}
writeFileSync(lock, String(process.pid));

const KPUB = "https://api.elections.kalshi.com/trade-api/v2";
const getJson = async (url: string, ms = 5_000) => {
  const r = await fetch(url, { headers: { Accept: "application/json", "user-agent": "macromiro-desk-observe" }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`GET ${url.split("?")[0]} ${r.status}`);
  return r.json();
};
const feeds = new Feeds(true);
const collector = new Collector(dir, feeds, new MoveGuard(), {
  openMarket: (s) => openMarket(s),
  orderbookRaw: (t) => getJson(`${KPUB}/markets/${t}/orderbook?depth=10`, 2_500),
  eventFee: (s, e) => eventFee(s, e),
  exchangeStatus: () => exchangeStatus(),
  marketResult: (t) => marketResult(t),
  candles: async (p, m) => parseCoinbaseCandles(await getJson(`${PUBLIC_HOST}/products/${p}/candles?granularity=${m * 60}`, 10_000)),
  trades: (p) => fetchPublicTrades(p, (u) => getJson(u, 10_000), 0, 1, 0),
}, () => ({ ...net }));

const stop = () => {
  feeds.flush();
  try {
    if (readFileSync(lock, "utf8").trim() === String(process.pid)) unlinkSync(lock);
  } catch {
    /* */
  }
  console.log(new Date().toISOString(), "collector stopped");
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await feeds.bootstrap().catch((e) => console.log("bootstrap", e instanceof Error ? e.message.slice(0, 120) : e));
feeds.start();
console.log(new Date().toISOString(), `collector started pid ${process.pid} dir ${dir} (read-only: GET-only fetch guard installed)`);
let n = 0;
setInterval(() => {
  n += 1;
  if (n % 12 === 0) {
    feeds.flush();
    feeds.prune(Date.now());
  }
  void collector.tick().catch((e) => console.log("tick", e instanceof Error ? e.message.slice(0, 160) : e));
}, 5_000);
setInterval(() => void collector.indicators().catch((e) => console.log("indicators", e instanceof Error ? e.message.slice(0, 160) : e)), 15_000);
setInterval(() => console.log(new Date().toISOString(), JSON.stringify({ rows: collector.status.rows, unique: collector.status.uniqueTickers, complete: collector.status.completeQuoteTickers, outcomes: collector.status.outcomes, errors: collector.status.errors, lastError: collector.status.lastError, feeds: feeds.status, net: { get: net.allowed, refused: net.refused } })), 60_000);
