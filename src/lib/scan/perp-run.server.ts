import { killBlocksTrade, liveExecutionAllowed } from "@/lib/envelope/kill.server";
import { tauricDebate } from "@/lib/agent/tauric-debate";
import { syncMirofish } from "@/lib/intel/mirofish";
import { loadPerps } from "./kalshi-perps";
import { armPerpBracket, marginCash, placePerpOrder } from "./kalshi-perp-order";
import { notePerpPrice, perpCount, perpDecision, perpStops } from "./perp-desk";

/** One Kalshi perpetual attempt per pass. A quiet book is a pass. Binary cash is not used. */
export async function runPerpScan(): Promise<string> {
  if (!liveExecutionAllowed()) return "perps waiting on the two switches";
  const blocked = killBlocksTrade(0);
  if (!blocked.ok) return blocked.why;
  await syncMirofish();
  const quotes = await loadPerps(true);
  if (!quotes.length) return "margin book empty";
  let last = "perps sit";
  for (const q of quotes) {
    const mid = (q.bid + q.ask) / 2 || q.ask || q.bid;
    notePerpPrice(q.ticker, mid);
    const call = perpDecision(q.ticker, q.bid, q.ask, q.lev);
    last = `${q.ticker} ${call.why}`;
    if (!call.take || !call.side) continue;
    const debate = tauricDebate({
      ticker: q.ticker,
      side: call.side,
      bid: q.bid,
      ask: q.ask,
      lev: q.lev,
      pushOverNoise: call.pushOverNoise,
    });
    if (!debate.ok) return debate.why;
    const cash = await marginCash().catch(() => 0);
    if (cash < 25) return `margin cash $${cash.toFixed(0)} · perp sits until that account is funded`;
    const count = perpCount(debate.limit, q.contractSize, q.lev, Math.min(35, Math.max(25, cash * 0.3)));
    const fill = await placePerpOrder({ ticker: q.ticker, side: call.side, price: debate.limit, count });
    const stops = perpStops(debate.limit, call.side, q.lev);
    await armPerpBracket(q.ticker, stops.stop, stops.takeProfit).catch(() => null);
    return `${debate.why} · ${fill.orderId}`;
  }
  return last;
}