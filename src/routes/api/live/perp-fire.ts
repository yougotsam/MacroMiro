import { createFileRoute } from "@tanstack/react-router";
import { readKill } from "@/lib/envelope/kill.server";
import { evaluatePerpEdge, type PerpTicker } from "@/lib/scan/edge";
import { armPerpBracket, placePerpOrder } from "@/lib/scan/kalshi-perp-order";

const NAMES = new Set(["KXGOLDPERP", "KXSILVERPERP", "KXBTCPERP", "KXETHPERP", "KXSOLPERP", "KXXRPPERP", "KXBNBPERP", "KXUS500PERP"]);

export const Route = createFileRoute("/api/live/perp-fire")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => null)) as {
          ticker?: string;
          side?: "bid" | "ask";
          leverage?: number;
          clipSizeUsd?: number;
          tpMultiple?: number;
          slPercent?: number;
          price?: number;
          bid?: number;
          ask?: number;
          maxLeverage?: number;
        } | null;
        const ticker = String(body?.ticker ?? "");
        if (!NAMES.has(ticker) || (body?.side !== "bid" && body?.side !== "ask")) {
          return Response.json({ ok: false, why: "bad fire request" }, { status: 400 });
        }
        const price = Number(body?.price);
        const bid = Number(body?.bid ?? price);
        const ask = Number(body?.ask ?? price);
        const maxLeverage = Number(body?.maxLeverage);
        const decision = evaluatePerpEdge(
          {
            ticker: ticker as PerpTicker,
            markPrice: price,
            bidPrice: bid > 0 ? bid : price,
            askPrice: ask > 0 ? ask : price,
            indexPrice: price,
            spreadBps: price > 0 ? (Math.abs(ask - bid) / price) * 10_000 : 0,
            maxLeverage: maxLeverage >= 1 ? maxLeverage : 15.2,
            fundingRateBps: 0,
            dailyPnLUsd: -readKill().dailyLossUsd,
          },
          {
            direction: body.side === "bid" ? "LONG" : "SHORT",
            confidenceScore: 100,
            catalystAlert: false,
            primaryThesis: "cockpit fire",
          },
          {
            selectedLeverage: Number(body?.leverage ?? 1),
            clipUsd: Number(body?.clipSizeUsd ?? 25),
            tpMultiple: Number(body?.tpMultiple ?? 2.5),
            slPercent: Number(body?.slPercent ?? 8),
            tauricThreshold: 68,
          },
        );
        if (decision.action !== "EXECUTE" || !decision.order) return Response.json({ ok: false, why: decision.reason });
        try {
          const fill = await placePerpOrder({
            ticker,
            side: decision.order.side,
            price: Number(decision.order.entryPrice),
            count: Number(decision.order.count),
          });
          await armPerpBracket(ticker, Number(decision.order.stopLossPrice), Number(decision.order.takeProfitPrice)).catch(() => null);
          return Response.json({ ok: true, why: decision.reason, orderId: fill.orderId, order: decision.order });
        } catch (err) {
          return Response.json({ ok: false, why: err instanceof Error ? err.message : "order failed", order: decision.order });
        }
      },
    },
  },
});
