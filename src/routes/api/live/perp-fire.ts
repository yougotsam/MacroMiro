import { createFileRoute } from "@tanstack/react-router";
import { switchState } from "@/lib/desk/risk";
import { liveMarginTransport } from "@/lib/perps/live-transport";
import { PerpsOms } from "@/lib/perps/oms";
import type { ManagePlan } from "@/lib/perps/manage";
import { perpStops } from "@/lib/scan/perp-desk";
import { dataDir } from "@/lib/desk/config";

const CAP = 3;

function perpPlan(price: number, side: "bid" | "ask", lev: number): ManagePlan {
  const stops = perpStops(price, side, lev);
  const dir = side === "ask" ? "short" : "long";
  const t1 = dir === "long" ? price + (stops.takeProfit - price) / 2 : price - (price - stops.takeProfit) / 2;
  return { dir, qty: 1, entry: price, stop: stops.stop, t1, t2: stops.takeProfit, partialFrac: 0.5, trailR: 1, maxHoldMs: 8 * 3_600_000 };
}

export const Route = createFileRoute("/api/live/perp-fire")({
  server: {
    handlers: {
      GET: async () => Response.json({ book: "perp", locked: false, capUsd: CAP, switches: switchState() }),
      POST: async ({ request }) => {
        const sw = switchState();
        if (!sw.live || !sw.begin || !sw.arm) return Response.json({ ok: false, why: "desk switches are off" }, { status: 409 });
        const body = (await request.json().catch(() => ({}))) as { ticker?: string; side?: "bid" | "ask"; price?: number; clipUsd?: number; leverage?: number };
        const ticker = String(body.ticker ?? "");
        const price = Number(body.price);
        const side = body.side === "ask" ? "ask" : "bid";
        const lev = Number(body.leverage);
        if (!/^KX[A-Z0-9]+PERP$/.test(ticker)) return Response.json({ ok: false, why: "perp ticker" }, { status: 400 });
        if (!(price > 0)) return Response.json({ ok: false, why: "price" }, { status: 400 });
        if (!(lev >= 2)) return Response.json({ ok: false, why: "perpetual leverage unread" }, { status: 400 });
        const margin = price / lev;
        if (!(margin > 0) || margin > CAP) return Response.json({ ok: false, why: `one contract posts $${margin.toFixed(2)} of margin, above the $${CAP} cap` }, { status: 400 });
        const oms = new PerpsOms(liveMarginTransport, `${dataDir()}/perps-journal.jsonl`, true);
        const sent = await oms.submit({
          kind: "entry",
          ticker,
          dir: side === "ask" ? "short" : "long",
          qty: 1,
          price,
          maker: true,
          plan: perpPlan(price, side, lev),
          decisionId: `perp-${ticker}-${Date.now()}`,
        });
        return Response.json({ ok: sent.status === "ACK", ...sent, leverage: lev });
      },
    },
  },
});