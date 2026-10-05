import { killBlocksTrade, liveExecutionAllowed, readKill } from "@/lib/envelope/kill.server";
import { tauricDebate } from "@/lib/agent/tauric-debate";
import { syncMirofish } from "@/lib/intel/mirofish";
import { fetchMiroFishForecast } from "@/lib/intelligence/mirofish-client";
import { runTauricDebate } from "@/lib/intelligence/tauric-debate";
import { loadPerps } from "./kalshi-perps";
import { armPerpBracket, marginCash, placePerpOrder } from "./kalshi-perp-order";
import { notePerpPrice, perpDecision } from "./perp-desk";
import { evaluatePerpEdge, type PerpTicker } from "./edge";
import { sliderCeiling } from "./perp-slider";

const NAMES = new Set<string>(["KXGOLDPERP", "KXSILVERPERP", "KXBTCPERP", "KXETHPERP", "KXSOLPERP", "KXXRPPERP", "KXBNBPERP", "KXUS500PERP"]);

/** One Kalshi perpetual attempt per pass. The slider is the ceiling. The debate may go lower. */
export async function runPerpScan(): Promise<string> {
  if (!liveExecutionAllowed()) return "perps waiting on the two switches";
  const blocked = killBlocksTrade(0);
  if (!blocked.ok) return blocked.why;
  await syncMirofish();
  const quotes = await loadPerps(true);
  if (!quotes.length) return "margin book empty";
  let last = "perps sit";
  for (const q of quotes) {
    if (!NAMES.has(q.ticker)) continue;
    const mid = (q.bid + q.ask) / 2 || q.ask || q.bid;
    notePerpPrice(q.ticker, mid);
    const call = perpDecision(q.ticker, q.bid, q.ask, q.lev);
    last = `${q.ticker} ${call.why}`;
    if (!call.take || !call.side) continue;
    const ceiling = sliderCeiling(q.ticker, q.lev);
    const gate = tauricDebate({
      ticker: q.ticker,
      side: call.side,
      bid: q.bid,
      ask: q.ask,
      lev: ceiling,
      pushOverNoise: call.pushOverNoise,
    });
    if (!gate.ok) return gate.why;
    let fish: Awaited<ReturnType<typeof fetchMiroFishForecast>> | undefined;
    try {
      fish = await fetchMiroFishForecast({
        ticker: q.ticker,
        catalystHeadline: call.why,
        currentPrice: mid,
        timeHorizonMinutes: 15,
      });
    } catch {
      fish = undefined;
    }
    const verdict = await runTauricDebate({
      ticker: q.ticker,
      spotPrice: mid,
      bidPrice: q.bid,
      askPrice: q.ask,
      leverageMax: q.lev,
      selectedLeverage: ceiling,
      shortTermMomentum: call.side === "ask" ? -call.pushOverNoise : call.pushOverNoise,
      mirofish: fish,
    });
    const want = call.side === "bid" ? "LONG" : "SHORT";
    if (verdict.action !== want) return `${q.ticker} debate stood down · ${verdict.arbitratorReasoning}`;
    const cash = await marginCash().catch(() => 0);
    if (cash < 25) return `margin cash $${cash.toFixed(0)} · perp sits until that account is funded`;
    const budget = Math.min(35, Math.max(25, cash * 0.3));
    const decision = evaluatePerpEdge(
      {
        ticker: q.ticker as PerpTicker,
        markPrice: mid,
        bidPrice: q.bid,
        askPrice: q.ask,
        indexPrice: mid,
        spreadBps: mid > 0 ? ((q.ask - q.bid) / mid) * 10_000 : 999,
        maxLeverage: q.lev,
        fundingRateBps: 0,
        dailyPnLUsd: -readKill().dailyLossUsd,
      },
      {
        direction: want,
        confidenceScore: verdict.convictionScore,
        catalystAlert: false,
        primaryThesis: verdict.arbitratorReasoning,
      },
      {
        selectedLeverage: Math.min(verdict.recommendedLeverage, ceiling),
        clipUsd: budget,
        tpMultiple: 2.5,
        slPercent: 8,
        tauricThreshold: 68,
      },
    );
    if (decision.action !== "EXECUTE" || !decision.order) return `${q.ticker} ${decision.reason}`;
    const count = Number(decision.order.count);
    const fill = await placePerpOrder({
      ticker: q.ticker,
      side: decision.order.side,
      price: Number(decision.order.entryPrice),
      count,
    });
    await armPerpBracket(q.ticker, Number(decision.order.stopLossPrice), Number(decision.order.takeProfitPrice)).catch(() => null);
    return `${decision.reason} · ${fill.orderId}`;
  }
  return last;
}